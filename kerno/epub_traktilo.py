import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup

class EpubTraktilo:
    def __init__(self, vojo):
        """
        Iniciatas la EPUB-traktilon por legi kaj manipuli la libron.
        """
        self.vojo = vojo
        self.libro = epub.read_epub(vojo)
        self.kapitoloj = []
        self._stiri_kapitolojn()

    def _stiri_kapitolojn(self): # Filtras nur tekstajn dokumentojn (HTML/XHTML) el la EPUB.
        """Filtras nur tekstajn dokumentojn (HTML/XHTML) el la EPUB."""
        for item in self.libro.get_items():
            if item.get_type() == ebooklib.ITEM_DOCUMENT:
                self.kapitoloj.append(item)

    def elstiri_tekston(self):
        """Redonas la liston de tekstaj eroj (kapitoloj)."""
        return self.kapitoloj

    def purigi_kaj_platigi_html(self, html_enhavo):
        """
        Specifa por Google Tradutor Free:
        Forigas span-ojn kaj aliajn malpurajxojn kiuj disigas vortojn.
        Tio evitas erarojn kiel 'O-HEPATO' (Oliver).
        """
        soup = BeautifulSoup(html_enhavo, 'html.parser') # Kreas BeautifulSoup-objekton.
        
        # 1. Forigi cxiujn span-ojn konservante la tekston (Unwrap)
        # Tio rekunigas vortojn disigitajn de stilo.
        for span in soup.find_all("span"):
            span.unwrap()
            
        # 2. Forigi cxiujn font-etikedojn.
        for f in soup.find_all("font"):
            f.unwrap()

        # 3. Forigi malplenajn etikedojn (krom br, img).
        for el in soup.find_all():
            if len(el.get_text(strip=True)) == 0 and el.name not in ['br', 'img', 'hr']:
                el.decompose()
                
        return str(soup)

    def dividi_en_blokojn(self, html_enhavo, max_karakteroj=5000, platigi=False):
        """
        Grupigas elementojn en blokojn.
        Se 'platigi' estas Vera, gxi purigas la HTML antauxe (ideala por Google Free).
        Se 'platigi' estas Falsa, gxi konservas la originalan strukturon (ideala por Gemini).
        """
        labor_html = html_enhavo
        if platigi:
            labor_html = self.purigi_kaj_platigi_html(html_enhavo)
            
        soup = BeautifulSoup(labor_html, 'html.parser') # Kreas BeautifulSoup-objekton el la labor-HTML.
        
        # Serĉas strukturajn elementojn.
        elementoj = soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'dt', 'dd'])
        
        blokoj = []
        nuna_bloko = ""
        
        for el in elementoj:
            el_html = str(el)
            # Se la elemento mem estas tro granda, ni almenaux metas gxin sola en blokon.
            # Se la elemento mem estas tro granda, ni almenaux metas gxin sola en blokon
            if len(el_html) > max_karakteroj and not nuna_bloko:
                blokoj.append(el_html)
                continue

            if len(nuna_bloko) + len(el_html) > max_karakteroj and nuna_bloko:
                blokoj.append(nuna_bloko)
                nuna_bloko = el_html
            else:
                nuna_bloko += el_html
        
        if nuna_bloko:
            blokoj.append(nuna_bloko)
            
        return blokoj

    def gxisdatigi_kapitolon(self, kapitolo_item, nova_enhavo_html):
        """Anstataŭigas la enhavon de la kapitolo per la tradukita HTML."""
        kapitolo_item.set_content(nova_enhavo_html.encode('utf-8'))