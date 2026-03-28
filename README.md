
# 📚 LibroTradukisto (Book Translator)

> *"La teknologio ĉiam estis aliancano de Esperanto."*

Hi there! I am Shamslux, a Brazilian Data Engineer and *lingvemulo* (passionate for languages). As an **Esperantist**, I have witnessed how technology has historically boosted our language—from early radio broadcasts to the Duolingo era. However, the community faces a modern challenge: the scarcity of contemporary literature translated into Esperanto. While human translation is the gold standard, the sheer volume of modern works makes relying solely on volunteers an impossible task. 

**LibroTradukisto** was born from this necessity. By leveraging the power of Large Language Models (LLMs) and the Google Translate API, this tool aims to provide accurate, context-aware translations that bring our language closer to the standards required by human readers.

### 🤖 Why Machines Love Esperanto
LLMs are proving to be remarkably reliable for our *Lingvo Internacia*. Because Esperanto is built on a logical, highly regular structure with no exceptions, machines themselves "find it easier" to process than traditional natural languages. This synergy allows LLMs to produce translations that are not just literal, but contextually rich, helping to renew and expand the Esperanto literary canon with unprecedented speed and accuracy.

***

### 💡 Inspiration and Vision
The technical foundation of this project is heavily inspired by the excellent [Ebook-Translator-Calibre-Plugin](https://github.com/bookfere/Ebook-Translator-Calibre-Plugin). As a long-time user of that plugin within Calibre, I admired its logic and used it as a roadmap to replicate the Google Translate API integration. 

However, I felt the need to build a standalone tool with a specific focus on the **Esperanto experience** and a different architectural approach to parsing:

* **Context-Rich Parsing:** Instead of a strict line-by-line approach, our engine groups HTML elements into larger thematic blocks. This provides LLMs with more narrative context, resulting in translations with better flow and stylistic consistency.
* **Flexible Manual Workflow:** While manual editing is a staple of great translation tools, LibroTradukisto's interface is optimized for a "Human-in-the-Loop" workflow. Beyond quick fixes, the manual mode allows you to easily copy entire HTML blocks to your **personal AI chat accounts** (like ChatGPT or Gemini Pro) and paste the refined results back, bypassing API limits while maintaining full control over the book's structure.

***

## ✨ Key Features

* **Smart EPUB Parsing:** Extracts text block by block while keeping structural HTML tags (`<b>`, `<i>`, `<p>`) entirely intact.
* **AI-Powered Translation:** Integrates natively with the Google Gemini API (supporting models like `gemini-2.0-flash`) for fast, context-aware translations.
* **Human-in-the-Loop (Manual Editor):** An interactive UI to review, tweak, and perfect the AI's output before compiling the final book.
* **Resilient Caching:** Progress is saved locally in a JSON file. If the API hits a rate limit or your internet drops, you don't lose a single translated word.
* **Multilingual UI:** The interface is dynamically translated into 8 languages (English, Esperanto, Portuguese, Spanish, Mandarin, French, German, and Russian). We may face some issues yet, but is usable in most cases.

***

### 🚀 Manual Mode Tutorial: The "Copy-Paste" Strategy

For maximum quality or when you prefer using your own AI chat interface:

1.  **Select & Extract:** In the "Manual Editor" tab, choose a chapter. The tool will display the original HTML blocks.
2.  **Translate Externally:** Copy the full content of a block (tags included). Paste it into your AI chat with a prompt like: *"Translate this HTML into Esperanto, keeping all tags intact."*
3.  **Refine & Save:** Paste the translated HTML back into the text area and click **"💾 Konservi Ŝanĝojn"** (or in the language you properly selected on the interface).
4.  **Final Build:** Once your chapters are ready (marked in green/yellow in the dashboard), generate your final EPUB.

***

##  How it Works

The workflow is designed to give you both automation and control:

1.  **Upload:** Upload your original `.epub` file.
2.  **Analyze:** The app parses the book's structure, dividing it into chapters and calculating the estimated translation time and total blocks.
3.  **Translate:** Choose your desired literary genre/style (e.g., General, Theology, Fantasy, Academic) and let the AI process the selected chapters. You can monitor the translation in real-time. We are using some pre-made AI prompts (in Esperanto, originally) for adjusting the AI tone. If in doubt, just hit *Generala*.
4.  **Edit (Optional):** Jump to the "Manual Editor" tab to fix specific nuances, adjust formatting, or translate complex paragraphs by hand.
5.  **Export:** Click generate, and the app reconstructs your EPUB, merging your local cache with the original stylesheets and images.

***

## 🛠️ Getting Started

### Prerequisites
Make sure you have Python 3.10+ installed.

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Shamslux/libro-tradukisto.git
cd libro-tradukisto
```

2. Install the required dependencies:
```bash
pip install -r postuloj.txt
```

3. Set up your environment variables:
Create a `.env` file in the root directory and add your Google Gemini API Key:
```env
GEMINI_API_KEY=your_api_key_here
```

4. Run the application:
```bash
streamlit run cxefpagxo.py
```

## 📂 Project Structure

* `cxefpagxo.py`: The main Streamlit interface.
* `kerno/`: The core engine containing the EPUB parser, AI clients, and translation logic.
* `lingvoj/`: JSON dictionaries and UI assets (like flags) for the multilingual interface.
* `eliroj/`: Default directory for local caching (`progres-konservo.json`) and temporary files.

## 🤝 Contributing

Contributions are welcome! Whether it's adding a new translation engine (like DeepL or Anthropic), improving the HTML parsing, or adding a new UI language, feel free to open an issue or submit a Pull Request.

***

## 📄 License

This project is licensed under the **GNU General Public License v3.0**. This ensures that the software remains free and open source, and any derivative works must also be shared under the same freedom-preserving conditions.


