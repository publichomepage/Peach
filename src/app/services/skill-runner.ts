/**
 * Tool Runner — manages internal tool definitions and execution.
 */

export interface Tool {
  name: string;
  description: string;
  arguments: { name: string; type: string; description: string }[];
  api: { endpoint: string; method: string };
  responseMapping: Record<string, string>;
}

// Hardcoded internal tools
export const TOOLS: Tool[] = [
  {
    name: 'get_current_weather',
    description: 'Get the current weather in a given location',
    arguments: [
      { name: 'location', type: 'string', description: 'city name, e.g. "London"' },
      { name: 'unit', type: 'string', description: '"celsius" or "fahrenheit"' }
    ],
    api: {
      endpoint: 'https://wttr.in/{location}?format=j1',
      method: 'GET'
    },
    responseMapping: {
      'Temperature (C)': 'current_condition[0].temp_C',
      'Condition': 'current_condition[0].weatherDesc[0].value',
      'Humidity': 'current_condition[0].humidity'
    }
  }
];

/**
 * Build a system prompt that tells the LLM about available tools.
 */
export function buildToolPrompt(): string {
  const toolDescriptions = TOOLS.map(tool => {
    const args = tool.arguments.map(a => `  - ${a.name}: ${a.type} (${a.description})`).join('\n');
    return `Tool: ${tool.name}\nDescription: ${tool.description}\nArguments:\n${args}`;
  }).join('\n\n');

  return `You are a function-calling coordinator. You have access to the following service tools:

${toolDescriptions}

If the user's request matches a tool, output a JSON object like this:
{
  "tool": "get_current_weather",
  "arguments": { "location": "London", "unit": "celsius" }
}

If no tool matches, output:
{ "tool": "none" }

RULES:
1. Output ONLY the JSON object.
2. DO NOT use <think> tags or internal thought processes.
3. DO NOT explain your reasoning.
4. DO NOT answer the question yourself.`;
}

/**
 * Parse LLM output to extract a tool invocation.
 */
export function parseToolCall(content: string): { tool: string; arguments: Record<string, string> } | null {
  try {
    // Find the last valid-looking JSON object in the string (in case of <think> preamble)
    const matches = content.match(/\{[\s\S]*\}/g);
    if (matches) {
      const lastMatch = matches[matches.length - 1];
      const parsed = JSON.parse(lastMatch);
      if (parsed.tool && parsed.tool !== 'none' && parsed.tool.trim().length > 0) {
        return { tool: parsed.tool, arguments: parsed.arguments || {} };
      }
      // Backward compatibility for old "skill" key (if model keeps hallucinating it)
      if (parsed.skill && parsed.skill !== 'none') {
        return { tool: parsed.skill, arguments: parsed.arguments || {} };
      }
    }
  } catch { }
  return null;
}

/**
 * Execute a tool by name.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, string>
): Promise<{ success: boolean; data?: Record<string, any>; error?: string }> {
  const tool = TOOLS.find(t => t.name.toLowerCase() === toolName.toLowerCase());

  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  let url = tool.api.endpoint;
  for (const [key, value] of Object.entries(args)) {
    url = url.replace(`{${key}}`, encodeURIComponent(value));
  }

  console.log(`[Tool] ${toolName} -> ${url}`);

  try {
    const res = await fetch(url);
    const json = await res.json();

    const data: Record<string, any> = {};
    for (const [key, path] of Object.entries(tool.responseMapping)) {
      data[key] = resolvePath(json, path);
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function resolvePath(obj: any, path: string): any {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export async function runToolAgent(engine: any, userMessage: string): Promise<{ wasToolUsed: boolean, result: string }> {
  if (!engine) return { wasToolUsed: false, result: '' };

  const messages = [
    { role: 'system', content: buildToolPrompt() },
    { role: 'user', content: 'What is the weather in Paris?' },
    { role: 'assistant', content: '{"tool": "get_current_weather", "arguments": {"location": "Paris", "unit": "celsius"}}' },
    { role: 'user', content: userMessage },
  ];

  const response = await engine.chat.completions.create({
    messages,
    temperature: 0.0,
    max_tokens: 256, // Allow space for thinking models to reach the JSON
    presence_penalty: 0.3,
    frequency_penalty: 0.3,
  });

  const content = response.choices[0]?.message?.content?.trim() || '';
  console.log(`[Router] LLM output: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);

  const toolCall = parseToolCall(content);
  
  if (!toolCall) {
    console.log('[Router] No tool matched.');
    return { wasToolUsed: false, result: '' };
  }

  const result = await executeTool(toolCall.tool, toolCall.arguments);

  if (!result.success) {
    return { wasToolUsed: true, result: `**❌ Error:** ${result.error}` };
  }

  const formattedLines = Object.entries(result.data!).map(([k, v]) => `**${k}**: ${v}`);
  return {
    wasToolUsed: true,
    result: formattedLines.join('\n')
  };
}
