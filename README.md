# 🍑 Peach

A high-performance, private, and **zero-cost** RAG (Retrieval-Augmented Generation) engine that runs entirely in your browser.

## 🚀 Key Features

*   **Zero Cost**: No server-side GPUs, no API keys, and no subscription fees. Everything runs on the client machine.
*   **Orma Indexing**: Ultra-fast, browser-native vector search powered by [Orama](https://orama.com/). Handles thousands of documents with sub-millisecond search times.
*   **WebLLM**: First-class support for on-device LLMs via [WebLLM](https://github.com/mlc-ai/web-llm) and WebGPU. Stream answers directly from local models like Qwen2.5.

## 🛠️ Stack

*   **Framework**: Angular 19
*   **Vector Search**: Orama (Sharded & lazy-loaded)
*   **Embeddings**: Transformers.js (`all-MiniLM-L6-v2`)
*   **Inference**: WebLLM (Qwen2.5-0.5B-Instruct)

## 🏁 Quick Start

1.  **Install Dependencies**
    ```bash
    npm install
    cd indexer && npm install && cd ..
    ```

2.  **Build Search Index**
    Place your `.md` files in `content/`, then run:
    ```bash
    cd indexer && node build-index.mjs
    ```

3.  **Run Locally**
    ```bash
    npm start
    ```
    Open [http://localhost:4200](http://localhost:4200) in your browser.
    *Note: A WebGPU-enabled browser (like Chrome 113+) is required for on-device LLM inference.*

## 🚀 Deployment

To deploy to GitHub Pages:

```bash
npm run deploy
```

This will build the project with the correct base-href (`/zero-rag/`) and push the `dist/slm/browser` folder to the `gh-pages` branch.

## 🔒 Privacy First

*   **Local Inference**: Your questions and the LLM's answers are processed entirely on your machine via WebGPU.
*   **No Tracking**: No user data, queries, or chat history are ever sent to a server.

---
License: MIT
