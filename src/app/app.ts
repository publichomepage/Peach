import { Component, signal, computed, OnInit, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchService, SearchResult } from './services/search.service';
import { EmbeddingService } from './services/embedding.service';
import { LlmService, SUPPORTED_MODELS } from './services/llm.service';
import { runToolAgent } from './services/tool-service';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: SearchResult[];
  isStreaming?: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewChecked {
  @ViewChild('chatContainer') chatContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('queryInput') queryInput!: ElementRef<HTMLTextAreaElement>;

  query = signal('');
  showSettings = signal(false);
  isKnowledgeMode = signal(false);
  githubToken = signal('');
  githubRepo = signal('');
  openaiKey = signal('');
  openaiBaseUrl = signal('https://api.openai.com');
  openaiModel = signal('');
  saveAsIs = signal(true);

  messages = signal<Message[]>([]);
  isProcessing = signal(false);
  supportedModels = SUPPORTED_MODELS;
  selectedModelId = computed(() => this.llmService.selectedModelId());

  // Service status
  readonly searchReady = computed(() => this.searchService.isLoaded());
  readonly embeddingReady = computed(() => this.embeddingService.isLoaded());
  readonly llmReady = computed(() => this.llmService.isLoaded());
  readonly webGPUSupported = computed(() => this.llmService.webGPUSupported());

  readonly searchLoading = computed(() => this.searchService.isLoading());
  readonly embeddingLoading = computed(() => this.embeddingService.isLoading());
  readonly llmLoading = computed(() => this.llmService.isLoading());

  readonly embeddingProgress = computed(() => this.embeddingService.loadProgress());
  readonly llmProgress = computed(() => this.llmService.loadProgress());

  readonly allReady = computed(() => this.searchReady() && this.embeddingReady());

  private shouldScroll = false;

  constructor(
    private searchService: SearchService,
    private embeddingService: EmbeddingService,
    private llmService: LlmService
  ) { }

  saveGithubSettings() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('githubToken', this.githubToken());
      localStorage.setItem('githubRepo', this.githubRepo());
      localStorage.setItem('openaiKey', this.openaiKey());
      localStorage.setItem('openaiBaseUrl', this.openaiBaseUrl());
      localStorage.setItem('openaiModel', this.openaiModel());
      localStorage.setItem('saveAsIs', String(this.saveAsIs()));
      // Update service config in real-time
      this.searchService.setGithubConfig(this.githubRepo(), this.githubToken());
    }
  }

  async ngOnInit() {
    if (typeof localStorage !== 'undefined') {
      const token = localStorage.getItem('githubToken') || '';
      const repo = localStorage.getItem('githubRepo') || '';
      this.githubToken.set(token);
      this.githubRepo.set(repo);
      this.openaiKey.set(localStorage.getItem('openaiKey') || '');
      this.openaiBaseUrl.set(localStorage.getItem('openaiBaseUrl') || 'https://api.openai.com');
      const savedModel = localStorage.getItem('openaiModel');
      this.openaiModel.set(savedModel !== null ? savedModel : '');
      this.saveAsIs.set(localStorage.getItem('saveAsIs') !== 'false');

      if (token && repo) {
        this.searchService.setGithubConfig(repo, token);
      }
    }

    // Load search index, embedding model, and skills in parallel
    await Promise.all([
      this.searchService.loadIndex(),
      this.embeddingService.loadModel()
    ]);

    // Start loading LLM in the background (non-blocking)
    this.llmService.loadModel();
  }

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  private scrollToBottom() {
    if (this.chatContainer) {
      const el = this.chatContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (this.isKnowledgeMode()) {
        this.submitKnowledge();
      } else {
        this.submitQuery();
      }
    }
  }

  private isFollowUpQuery(query: string): boolean {
    const q = query.toLowerCase();
    const followUpPatterns = [
      'more info', 'tell me more', 'elaborate', 'explain',
      'details', 'that', 'this', 'give me more', 'why', 'how so'
    ];

    // If very short or contains follow-up keywords
    return q.length < 25 && followUpPatterns.some(p => q.includes(p));
  }

  async submitQuery() {
    const q = this.query().trim();
    if (!q || this.isProcessing()) return;

    const currentMessages = this.messages();
    const lastAssistantMsg = [...currentMessages].reverse().find(m => m.role === 'assistant');

    const isFollowUp = currentMessages.length > 0 && this.isFollowUpQuery(q);

    this.isProcessing.set(true);
    this.shouldScroll = true;

    // Add user message
    this.messages.update(msgs => [...msgs, { role: 'user', content: q }]);
    this.query.set('');

    try {
      if (this.llmService.isLoaded()) {
        // Quick pass: check if this matches any available skill
        const engine = this.llmService.getEngine();
        const skillCheck = await runToolAgent(engine, q);

        if (skillCheck.wasToolUsed) {
          console.log('✅ Chat query intercepted by Skill Agent');
          this.messages.update(msgs => {
            return [
              ...msgs,
              { role: 'assistant', content: skillCheck.result, isStreaming: false }
            ];
          });
          this.isProcessing.set(false);
          this.shouldScroll = true;
          return; // Stop here, no need for RAG
        }
      }

      let results: SearchResult[] = [];
      const MATCH_THRESHOLD = 0.25;

      if (isFollowUp && lastAssistantMsg?.sources) {
        // Reuse previous context if it's a short follow-up
        results = lastAssistantMsg.sources;
        console.log('🔄 Reusing existing context for follow-up query');
      } else {
        // 1. Embed the query
        const embedding = await this.embeddingService.embed(q);

        // 2. Search for relevant chunks
        const allResults = await this.searchService.search(embedding, 5);

        // Filter out low-quality matches to prevent hallucinations (reject anything < 25%)
        results = allResults.filter(r => r.score >= MATCH_THRESHOLD);

        if (results.length === 0 && allResults.length > 0) {
          console.warn(`⚠️ Rejected ${allResults.length} matches below ${MATCH_THRESHOLD * 100}% threshold.`);
        }
      }

      // 3. Add assistant message placeholder
      const assistantMsg: Message = {
        role: 'assistant',
        content: '',
        sources: results,
        isStreaming: true,
      };
      this.messages.update(msgs => [...msgs, assistantMsg]);

      // 4. Generate answer with LLM (streaming)
      if (this.llmService.isLoaded()) {
        // Take only previous completed turns (history only)
        const history = this.messages().slice(0, -2);
        for await (const chunk of this.llmService.generateStream(q, results, history)) {
          this.messages.update(msgs => {
            const updated = [...msgs];
            const last = { ...updated[updated.length - 1] };
            last.content += chunk;
            updated[updated.length - 1] = last;
            return updated;
          });
          this.shouldScroll = true;
        }
      } else {
        // Fallback: show context excerpts
        const fallback = results.length > 0
          ? `Here's what I found in the docs:\n\n${results.map(r => `**${r.heading}** (${r.source})\n${r.text.substring(0, 300)}...`).join('\n\n')}`
          : 'No relevant results found.';

        this.messages.update(msgs => {
          const updated = [...msgs];
          const last = { ...updated[updated.length - 1] };
          last.content = fallback;
          updated[updated.length - 1] = last;
          return updated;
        });
      }

      // Mark streaming as done
      this.messages.update(msgs => {
        const updated = [...msgs];
        const last = { ...updated[updated.length - 1] };
        last.isStreaming = false;
        updated[updated.length - 1] = last;
        return updated;
      });
    } catch (err: any) {
      this.messages.update(msgs => [
        ...msgs,
        { role: 'assistant', content: `Error: ${err.message}`, sources: [] },
      ]);
    } finally {
      this.isProcessing.set(false);
      this.shouldScroll = true;
    }
  }

  onProviderChange(event: Event) {
    const provider = (event.target as HTMLSelectElement).value;
    switch (provider) {
      case 'openai':
        this.openaiBaseUrl.set('https://api.openai.com/v1');
        break;
      case 'openrouter':
        this.openaiBaseUrl.set('https://openrouter.ai/api/v1');
        break;
      case 'deepseek':
        this.openaiBaseUrl.set('https://api.deepseek.com');
        break;
    }
    this.saveGithubSettings();
  }

  onModelChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    if (target) {
      this.llmService.switchModel(target.value);
    }
  }

  async runToolDemo() {
    if (this.isProcessing() || !this.llmReady()) return;

    this.isProcessing.set(true);
    this.shouldScroll = true;

    const question = 'What is the weather in London right now in celsius?';

    // Add user message
    this.messages.update(msgs => [...msgs, { role: 'user', content: question }]);

    // Add waiting message
    this.messages.update(msgs => [...msgs, { role: 'assistant', content: '📡 Fetching live data...', isStreaming: true }]);

    try {
      const engine = this.llmService.getEngine();
      const result = await runToolAgent(engine, question);

      this.messages.update(msgs => {
        const updated = [...msgs];
        updated[updated.length - 1] = { role: 'assistant', content: result.result, isStreaming: false };
        return updated;
      });
    } catch (err: any) {
      this.messages.update(msgs => {
        const updated = [...msgs];
        updated[updated.length - 1] = { role: 'assistant', content: `Skill agent failed: ${err.message}`, isStreaming: false };
        return updated;
      });
    } finally {
      this.isProcessing.set(false);
      this.shouldScroll = true;
    }
  }

  clearChat() {
    this.messages.set([]);
    this.query.set('');
  }

  getModelShortName(): string {
    return this.llmService.selectedModelId().split('-')[0] || 'LLM';
  }

  goHome() {
    this.showSettings.set(false);
    this.clearChat();
  }

  openSource(source: string) {
    // Fallback to the main repo if settings are empty
    let repo = (this.githubRepo() || 'publichomepage/zero-rag').trim();
    if (repo.endsWith('/')) repo = repo.slice(0, -1);

    // If source already has 'docs/' at the start, don't add it again
    const path = source.startsWith('docs/') ? source : `docs/${source}`;
    
    // Always open on GitHub
    const githubUrl = `https://github.com/${repo}/tree/main/${path}`;
    window.open(githubUrl, '_blank');
  }

  private detectMarkdown(text: string): boolean {
    const markers = [
      /^#{1,6}\s+/m,           // headings
      /^\s*[-*+]\s+/m,         // unordered lists
      /^\s*\d+\.\s+/m,         // ordered lists
      /```[\s\S]*?```/,        // fenced code blocks
      /\[.+?\]\(.+?\)/,        // links
      /\*\*.+?\*\*/,           // bold
      /^\s*>/m,                // blockquotes
      /^\|.+\|/m,             // tables
    ];
    const hits = markers.filter(r => r.test(text)).length;
    return hits >= 2;
  }

  private generateFilename(markdown: string): string {
    // Try to extract from first heading
    const headingMatch = markdown.match(/^#{1,6}\s+(.+)/m);
    let basis = headingMatch ? headingMatch[1] : markdown.split('\n').find(l => l.trim())?.trim() || 'untitled';

    // Strip markdown formatting from the basis
    basis = basis.replace(/[*_`\[\]()#]/g, '').trim();

    // Convert to kebab-case: lowercase, take first 3-4 words, replace non-alphanum with hyphens
    const kebab = basis
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 0)
      .slice(0, 4)
      .join('-')
      .replace(/[^a-z0-9-]+/g, '')
      .replace(/^-+|-+$/g, '');

    return (kebab || 'untitled') + '.md';
  }


  async submitKnowledge() {
    const rawText = this.query().trim();
    const needsLocalLlm = !this.saveAsIs() && !this.openaiKey();
    if (!rawText || this.isProcessing() || (needsLocalLlm && !this.llmReady())) return;

    if (!this.githubToken() || !this.githubRepo()) {
      alert('Please set your GitHub Token and Repo (owner/repo) in Settings first!');
      return;
    }

    this.isProcessing.set(true);
    this.isKnowledgeMode.set(false); // revert back to chat
    this.query.set('');

    this.messages.update(msgs => [
      ...msgs,
      { role: 'user', content: `[KNOWLEDGE BANK SUBMISSION]\n${rawText}` },
      { role: 'assistant', content: '📝 Formatting content into Markdown...', isStreaming: true }
    ]);
    this.shouldScroll = true;

    try {
      let markdownContent = '';

      if (this.saveAsIs()) {
        // Save raw text directly — no formatting
        markdownContent = rawText;
      } else if (this.openaiKey()) {
        // Use OpenAI API for formatting
        let baseUrl = this.openaiBaseUrl().trim().replace(/\/+$/, '');
        
        // Ensure OpenRouter has its /api prefix if the user just entered the domain
        if (baseUrl.includes('openrouter.ai') && !baseUrl.includes('/api')) {
          baseUrl = `${baseUrl}/api/v1`;
        }

        // Standard OpenAI-compatible pathing
        const url = baseUrl.endsWith('/chat/completions') 
          ? baseUrl 
          : `${baseUrl}/chat/completions`.replace(/([^:])\/\/+/g, '$1/');

        const oaiRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.openaiKey()}`,
            'Content-Type': 'application/json',
            // Required by OpenRouter and others for browser-based requests
            'HTTP-Referer': window.location.origin,
            'X-Title': 'Peach Knowledge Bank'
          },
          body: JSON.stringify({
            model: this.openaiModel() || 'gpt-4.1-nano',
            temperature: 0,
            max_tokens: 2000,
            messages: [
              {
                role: 'system',
                content: 'Format the user\'s text as clean Markdown. ONLY add Markdown syntax (headings, lists, bold, code blocks). NEVER add, remove, or change any words. Output ONLY the Markdown.'
              },
              { role: 'user', content: rawText }
            ]
          })
        });

        if (!oaiRes.ok) {
          const err = await oaiRes.json();
          throw new Error(`OpenAI API error: ${err.error?.message || oaiRes.statusText}`);
        }

        const oaiData = await oaiRes.json();
        let resultText = oaiData.choices?.[0]?.message?.content?.trim() || '';
        resultText = resultText.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
        markdownContent = resultText || rawText;
      } else {
        // Use local WebLLM with few-shot prompting
        const engine = this.llmService.getEngine();

        const response = await engine.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: 'Format text as Markdown. ONLY add Markdown syntax (headings, lists, bold). NEVER add new words. Output the exact same words with Markdown formatting.'
            },
            { role: 'user', content: '/no_think\nFormat as Markdown:\n\nshopping    amazon.com\nnews        bbc.com\nvideos      youtube.com' },
            { role: 'assistant', content: '# Links\n\n- **shopping** — amazon.com\n- **news** — bbc.com\n- **videos** — youtube.com' },
            { role: 'user', content: '/no_think\nFormat as Markdown:\n\nProject Setup\nInstall node version 18. Run npm install to get dependencies. Then run npm start to launch the dev server on port 3000.' },
            { role: 'assistant', content: '# Project Setup\n\nInstall node version 18. Run `npm install` to get dependencies. Then run `npm start` to launch the dev server on port 3000.' },
            {
              role: 'user',
              content: `/no_think\nFormat as Markdown:\n\n${rawText}`
            }
          ],
          temperature: 0.0,
          max_tokens: 1500
        });

        let resultText = response.choices[0]?.message?.content?.trim() || '';

        // Strip <think> blocks (Qwen 3 thinking mode)
        resultText = resultText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (resultText.startsWith('<think>')) resultText = '';

        // Strip wrapping ```markdown fences
        resultText = resultText.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();

        // Strip preamble lines
        resultText = resultText.replace(/^(?:okay|here|sure|let me|let's|I'll|the following)[^\n]*\n+/i, '').trim();

        markdownContent = resultText || rawText;
      }

      const filename = this.generateFilename(markdownContent);

      // Show formatted preview
      this.messages.update(msgs => {
        const updated = [...msgs];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `**Found Filename:** \`${filename}\`\n\nUploading to GitHub repo \`${this.githubRepo()}\`...`,
          isStreaming: true
        };
        return updated;
      });

      // Upload to GitHub
      const fileUrl = `https://api.github.com/repos/${this.githubRepo()}/contents/docs/${filename}`;
      // Basic base64 encode supporting utf-8
      const contentBase64 = btoa(unescape(encodeURIComponent(markdownContent)));

      const ghRes = await fetch(fileUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.githubToken()}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Add knowledge base doc: ${filename}`,
          content: contentBase64
        })
      });

      let finalMsg = '';
      if (!ghRes.ok) {
        const errorData = await ghRes.json();
        finalMsg = `❌ **GitHub Upload Failed:** ${errorData.message}`;
      } else {
        const ghData = await ghRes.json();
        finalMsg = `✅ **Successfully Uploaded!**
        
The file \`${filename}\` has been committed to your repository. 

**Note:** Building the search index for this document (takes few minutes). 
*   Refresh in a few minutes to see the new context.

[View on GitHub](${ghData.content.html_url})

---
**Preview:**
${markdownContent.substring(0, 300)}...`;
      }

      this.messages.update(msgs => {
        const updated = [...msgs];
        updated[updated.length - 1] = { role: 'assistant', content: finalMsg, isStreaming: false };
        return updated;
      });

    } catch (err: any) {
      this.messages.update(msgs => {
        const updated = [...msgs];
        updated[updated.length - 1] = { role: 'assistant', content: `Error: ${err.message}`, isStreaming: false };
        return updated;
      });
    } finally {
      this.isProcessing.set(false);
      this.shouldScroll = true;
    }
  }
}
