# ⚡ Zero-RAG

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

## 🔒 Privacy First

Your data never leaves your browser. Document chunking, embedding generation, vector search, and LLM inference all happen locally using WebGPU acceleration.

---
License: MIT
