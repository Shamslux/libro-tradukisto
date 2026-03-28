
![Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white)
![Python](https://img.shields.io/badge/Python-FFD43B?style=for-the-badge&logo=python&logoColor=blue)
![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=for-the-badge&logo=Streamlit&logoColor=white)
![Pandas](https://img.shields.io/badge/Pandas-2C2D72?style=for-the-badge&logo=pandas&logoColor=white)
![Github](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)
![Markdown](https://img.shields.io/badge/Markdown-000000?style=for-the-badge&logo=markdown&logoColor=white)
![JSON](https://img.shields.io/badge/json-5E5C5C?style=for-the-badge&logo=json&logoColor=white)
![GoogleTranslate](https://img.shields.io/badge/Google%20Translate-4285F4?style=for-the-badge&logo=google-translate&logoColor=white)
![GPL-3](https://img.shields.io/badge/GPL--3.0-red?style=for-the-badge)

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
## 🖼️ Image Simple Tutorial and Tour

![main_page_without_upload](https://github.com/user-attachments/assets/b1e920a6-91f7-4c70-9b54-82e09dafc7a5)
> Main page before any upload.

![main_page_after_an_upload](https://github.com/user-attachments/assets/d645ca7b-7610-40ab-bb2f-af654176c286)
> After a book upload. We can use the first tab to analyse the `epub` and its structure. The JSON file will record, for the files uploaded, the structure to be translated.
> NOTE: The software will not save the file, just the structure, you may reupload it several times till the completion of edition.

![first_tab_1](https://github.com/user-attachments/assets/e5ecce5d-7533-4c56-bd10-6f857218bad3)
> Here we can see the vision that allows us to understand what was already done (green ones) and what is to be done yet (red ones). In case of fails, we may see yellow ones,
> meaning the structure is semi-translated.

![first_tab_2](https://github.com/user-attachments/assets/8e8f46d6-18f0-4d92-a235-a32c1e17e8dd)
> We receive a estimative of how long API will take to translate (data for Gemini API, for Google Translate Free it is almost automatic, since it runs faster.
> We can choose the blocks we would like to translate. These blocks have subblocks (mostly for GT API, for Gemini, we send the whole HTML block for larger context
> and to save resources. *Antaŭrigardo de Originala Enhavo* allows the user to have a preview of the HTML block, namely, you will see the renderized ebook content
> for that block.

![first_tab_3](https://github.com/user-attachments/assets/f216e351-0784-47cb-96c0-cf8b128f20fe)
> The button for *KOMENCI TRADUKON* starts the process. (Currently, to kill the process, just use the terminal with `CTRL+C` (Windows). I am still thinking in a way to create a 'kill button'.
> *VIVA MONITORO* allows the user to briefly see the live process of translation. It has been a challenge, but my main goal was to show on the left the original source and, on the right, the translated one.
> *GENERI EPUB EL KASXO* will generate the new .epub from the cached information (the JSON). It will save the new ebook translated.
> NOTE: You can try another ebook editor, such as the own Calibre later to modify the metadata. Using Nano Banana 2 is possible to ask it to generate a new cover translated to Esperanto, nice tip, not? :D

![second_tab_1](https://github.com/user-attachments/assets/c0984930-9f73-496f-bf8b-075798b44519)
> Here we can manually edit the file. This first view is just showing, as the previous tab, the progress of the blocks (which ones were translated, are semi-translated or to be translated yet).

![second_tab_2](https://github.com/user-attachments/assets/b6c99c47-c2e3-4e2a-9577-800e9d8dbfc5)
> This is where the manual magic happens! We can choose the block/chapter to manually edit. The block view (green/gray blocks) shows the subblocks statuses (how many were translated). Now
> I adjusted to the block bring the whole HTML, but in previous versions while developping, it was with many fragments based on how it was to send for Google Translate API. One can use `CTRL+ENTER`
> to apply the adjustments or click on the disk icon button *KONSERVI SXANGXOJN*. Also the user can generate the ebook (totally or not totally translated).

![third_tab_1](https://github.com/user-attachments/assets/297020d6-1f21-4657-ab41-fca06b41d711)
> This is a more user friendly interface to earase the JSON file. It is possible to manually edit it on the directory using a code editor too.
> Well, the JSON file registers the structures as it parses the ebooks. For now, I just tested two ebooks, the names of the structures were
> different, but we may face similar structures, so I advise first complete a translation and after going to the next one (I did not exausted the
> testing for QA). Anyway, be careful using this tab, since you also may erase the whole file if desired. In this case, all work done will vanish.
> Think wisely, since while using Gemini API, the blocks translated costs requests, so if you erase the JSON, the already translated blocks will vanish forever.
> This tab is good when needing to remove a bad block and retranslating it (you also can try using the editing tab, if necessary, but sometimes you may need
> return the original block for a more precise translation as desired).

![final_tab](https://github.com/user-attachments/assets/5fc0cfcf-7a6d-4d73-a9ab-282d31d8c846)
> Finally, this is just a tab showing the models found using the API key (mine, in the above example). It does not help too much, I know, but I kept it anyway.
> For control, I suggest the user to being alert to observe his/her dashboard on **Google AI Studio**.

***

### Shamslux's Note

Although I am a Data Engineer, I need to confess that I do not come from native programming world. So, Python is not my strong side, I mean, surely I could do it,
but let's be honest: I started using Python in 2022, so LLMs were already here. I rely on them and I am not ashamed, since this whole project took me about 6h.
I will keep reviewing it and I know out there are many brilliant and much, but much better programmers than me (since I am not some brilliant programmer, I am not
ashamed allow a machine code for me, since I know these LLMs are coding better than the average of coders).

Well, I focused on trying to create a good process. Surely, it took 6h, so there still things to review. Besides, I did it by myself, what is good for some aspect,
but bad for other, since we may be "blind" to some attention points others could suggest an improvment. I am open to your suggestions! 

Finally, it was a very fun project and I imagine it may be useful for the Esperantist community. This is my main goal (surely, someone else could also adapt it for
other languages, why not?). But for now, Esperanto is a strong language that LLMs know a lot about and can generate accurate and good translations and this software
also allows humans to adjust something they may find not well fit.

In the end, this software, as the own AIs around us, are all tools to help us excel in creativity and create faster solutions for helping others. Well, at least,
my intention was to help others. ❤️

Thank you all! 
*Soli Deo Gloria*

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


