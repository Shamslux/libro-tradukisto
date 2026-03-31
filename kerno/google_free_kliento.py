import requests
import re
import time
from bs4 import BeautifulSoup

class GoogleFreeKliento:
    def __init__(self, cel_lingvo: str = "eo"):
        """
        Iniciatas la senpagan Google-tradukilon (GTX tekniko).
        Uzas inteligentan DOM-grupigon por konservi kuntekston sen detrui etikedojn.
        """
        self.endpoint = 'https://translate.googleapis.com/translate_a/single'
        self.headers = { # Ĝisdatigita User-Agent
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        }
        self.cel_lingvo = cel_lingvo

    def traduki_blokon(self, html_teksto: str, prompt_content: str = "", vortaro: dict = None, retestoj: int = 3, **kwargs) -> str:
        """
        Tradukas elementon post elemento (p, h1, li). Tio konservas la fraz-strukturon
        por Google Tradukilo. Ni uzas **kwargs por eviti erarojn se aliaj parametroj 
        estas sendataj de la ĉefa tradukisto (ekz. parametroj por Gemini).
        """
        if not html_teksto.strip():
            return html_teksto

        soup = BeautifulSoup(html_teksto, 'html.parser') # Analizas la HTML-tekston.

        # 1. IDENTIGU STRUKTURAJN ELEMENTOJN
        elementoj = soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'dt', 'dd'])
        
        # Se neniu struktura elemento trovigxas, ni tradukas la tutan korpon.
        if not elementoj:
            elementoj = [soup]

        for el in elementoj: # Trairas ĉiun elementon por traduki.
            originala_teksto = el.get_text().strip()
            if not originala_teksto or not re.search(r'[a-zA-Z]', originala_teksto):
                continue

            # 2. PREPARO POR TRADUKO
            # Ni uzas separatoron por provi konservi distancon inter sub-elementoj
            teksto_por_traduki = el.get_text(separator=" ")

            # 3. VOKI LA API
            tradukita_teksto = self._voki_api(teksto_por_traduki)

            # 4. APLIKI GLOSARON
            if vortaro:
                for orig, trad in vortaro.items():
                    shablono_vorto = rf"\b{re.escape(orig)}\b"
                    tradukita_teksto = re.sub(shablono_vorto, trad, tradukita_teksto, flags=re.IGNORECASE)

            # 5. REKREI LA ENHAVON
            # Atento: el.string anstataŭigas ĉion interne per pura teksto.
            # Ĉi tio evitas koruptadon de la HTML per la senpaga API.
            el.clear()
            el.string = tradukita_teksto.strip()
            
            # Malgranda paŭzo por eviti "429 Too Many Requests"
            time.sleep(0.2)

        # 6. POST-PROCESADO
        rezulto = str(soup) # Konvertas la modifitan 'soup' al string.
        if self.cel_lingvo == "eo": # Aplikos Esperanto-specifan korekton nur se la cel-lingvo estas Esperanto.
            return self._korekti_kapitulan_eron(rezulto)
        return rezulto

    def _korekti_kapitulan_eron(self, teksto: str) -> str:
        """ Riparas la eraron 'T lia' tipa de Drop Caps kiam la cel-lingvo estas Esperanto. """
        serĉo = re.search(r'^(<[^>]+>)([A-Z])(<[^>]+>)\s+lia\b', teksto) # Serĉas la eraron.
        if serĉo:
            etikedo1, litero, etikedo2 = serĉo.groups()
            if litero == "T":
                return f"{etikedo1}Ĉi{etikedo2} tiu" + teksto[serĉo.end():]
            return f"{etikedo1}{litero}{etikedo2} tiu" + teksto[serĉo.end():]
        return teksto

    def _voki_api(self, teksto_pura: str) -> str:
        """ Vokas la senpagan servon de Google Translate kun provo-ciklo (retry loop). """
        if not teksto_pura.strip(): # Kontrolas ĉu la teksto estas malplena.
            return teksto_pura
            
        params = { # Parametroj por la API-voko.
            'client': 'gtx', 
            'sl': 'auto', # Source language is auto-detected
            'tl': self.cel_lingvo, # Use the selected target language
            'dt': 't',
            'dj': 1,
            'q': teksto_pura,
        }
        
        for provo in range(3):
            try:
                r = requests.get(self.endpoint, params=params, headers=self.headers, timeout=15) # Faras la GET-peton.
                r.raise_for_status()
                datumoj = r.json()
                
                traduko = ""
                if 'sentences' in datumoj:
                    for frazo in datumoj['sentences']:
                        if 'trans' in frazo:
                            traduko += frazo['trans']
                return traduko
            except Exception as e:
                if provo == 2: # Lasta provo malsukcesis
                    print(f"Eraro ĉe Google Free API post 3 provoj: {e}")
                    return teksto_pura
                time.sleep(1 * (provo + 1)) # Atendas iomete antaŭ repravi
        return teksto_pura