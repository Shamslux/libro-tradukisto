import requests
import re
import time
from bs4 import BeautifulSoup

class GoogleFreeKliento:
    def __init__(self):
        """
        Iniciatas la senpagan Google-tradukilon (GTX tekniko).
        Uzas inteligentan DOM-grupigon por konservi kuntekston sen detrui etikedojn.
        """
        self.endpoint = 'https://translate.googleapis.com/translate_a/single'
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        }

    def traduki_blokon(self, html_teksto: str, genro: str, vortaro: dict = None, retestoj: int = 3) -> str:
        """
        Tradukas elementon post elemento (p, h1, li). Tio konservas la fraz-strukturon
        por Google Tradukilo dum gxi tute protektas la HTML-atributojn.
        """
        if not html_teksto.strip():
            return html_teksto

        soup = BeautifulSoup(html_teksto, 'html.parser')

        # 1. IDENTIGU STRUKTURAJN ELEMENTOJN
        # Ni sercxas cxiun paragrafon, titolon aux liston por traduki ilin kiel tuton.
        elementoj = soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'dt', 'dd'])
        
        # Se neniu struktura elemento trovigxas, ni tradukas la tutan korpon
        if not elementoj:
            elementoj = [soup]

        for el in elementoj:
            # Ni ekstraktas la puran tekston de la elemento (inkluzive de sub-etikedoj kiel <b>, <i>)
            # sed ni tradukas nur se estas literoj.
            originala_teksto = el.get_text()
            if not re.search(r'[a-zA-Z]', originala_teksto):
                continue

            # 2. PROTEKTO DE INTERNAJ ETIKEDOJ (ekz. <b> aux <a> interne de paragrafo)
            # Ni uzas simplan lokotenilon por internaj etikedoj por ne perdi formaton.
            internaj_etikedoj = re.findall(r'<[^>]+>', str(el.decode_contents()))
            teksto_por_traduki = el.get_text(separator=" ___ ") # Uzas spacon por ne glui vortojn

            # 3. VOKI LA API POR CXIU ELEMENTO (Donas pli da kunteksto ol vorto-post-vorto)
            tradukita_teksto = self._voki_api(teksto_por_traduki)

            # 4. APLIKI GLOSARON
            if vortaro:
                for orig, trad in vortaro.items():
                    shablono_vorto = rf"\b{re.escape(orig)}\b"
                    tradukita_teksto = re.sub(shablono_vorto, trad, tradukita_teksto, flags=re.IGNORECASE)

            # 5. REKREI LA ENHAVON DE LA ELEMENTO
            # Por la senpaga API, la plej sekura maniero ne korupti la HTML estas 
            # anstatauxigi la tutan enhavon per la tradukita teksto, purigante la 'soup'.
            # Se vi bezonas konservi <b> aux <i> interne, la Gemini estas pli tauxga.
            # Cxi tie ni prioritatas la legeblecon de la teksto.
            el.string = tradukita_teksto.replace(" ___ ", " ").strip()

        # 6. POST-PROCESADO
        rezulto = str(soup)
        return self._korekti_kapitulan_eron(rezulto)

    def _korekti_kapitulan_eron(self, teksto: str) -> str:
        """ Riparas la eraron 'T lia' tipa de Drop Caps. """
        serĉo = re.search(r'^(<[^>]+>)([A-Z])(<[^>]+>)\s+lia\b', teksto)
        if serĉo:
            etikedo1, litero, etikedo2 = serĉo.groups()
            if litero == "T":
                return f"{etikedo1}Ĉi{etikedo2} tiu" + teksto[serĉo.end():]
            return f"{etikedo1}{litero}{etikedo2}tiu" + teksto[serĉo.end():]
        return teksto

    def _voki_api(self, teksto_pura: str) -> str:
        """ Vokas la senpagan servon de Google Translate. """
        if not teksto_pura.strip():
            return teksto_pura
            
        params = {
            'client': 'gtx',
            'sl': 'auto',
            'tl': 'eo',
            'dt': 't',
            'dj': 1,
            'q': teksto_pura,
        }
        try:
            r = requests.get(self.endpoint, params=params, headers=self.headers, timeout=15)
            r.raise_for_status()
            datumoj = r.json()
            traduko = ""
            if 'sentences' in datumoj:
                for frazo in datumoj['sentences']:
                    if 'trans' in frazo:
                        traduko += frazo['trans']
            return traduko
        except Exception as e:
            print(f"Eraro ĉe Google Free API: {e}")
            return teksto_pura