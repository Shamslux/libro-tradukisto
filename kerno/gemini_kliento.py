import os
import time
from google import genai
from dotenv import load_dotenv

load_dotenv()

class GeminiKliento:
    def __init__(self, api_shlosilo: str = None, modelo_nomo: str = None, cel_lingvo: str = "eo"):
        """
        Iniciatas la Gemini-klienton kun kapablo monitori modelan sanon.
        """
        self.shlosilo = api_shlosilo if api_shlosilo else os.getenv("GEMINI_API_KEY")
        if not self.shlosilo:
            raise ValueError("Eraro: API-shlosilo ne trovita!")
            
        self.client = genai.Client(api_key=self.shlosilo) # Gemini API-kliento.
        self.modelo_nomo = modelo_nomo if modelo_nomo else "gemini-2.0-flash"
        self.cel_lingvo = cel_lingvo
        
        # Vortaro por konservi la staton de la modeloj dum la seanco
        self.sano_de_modeloj = {}
        
        # Mapado de lingvo-kodoj al plenaj nomoj por la instrukcio
        self.lingvo_nomoj = {
            "eo": "Esperanto",
            "pt": "Português",
            "en": "English",
            "es": "Español",
            "zh": "中文",
            "fr": "Français",
            "de": "Deutsch",
            "ru": "Русский"
        }

    def detaligi_modelojn(self) -> list:
        """
        Liveras liston de vortaroj kun teknikaj detaloj pri cxiuj disponeblaj modeloj.
        """
        listo_de_detaloj = [] # Listo por konservi modelajn detalojn.
        try:
            for modelo in self.client.models.list():
                nomo = getattr(modelo, 'name', '').replace("models/", "")
                
                if "gemini" in nomo.lower():
                    eniga_limo = getattr(modelo, 'input_token_limit', 'N/A')
                    eliga_limo = getattr(modelo, 'output_token_limit', 'N/A')
                    versio = getattr(modelo, 'version', 'N/A')
                    
                    subtenas_vidon = "Jes" if "1.5" in nomo or "2.0" in nomo else "Nekonata"

                    detaloj = {
                        "nomo": nomo,
                        "versio": versio,
                        "eniga_limo": eniga_limo,
                        "eliga_limo": eliga_limo,
                        "subtenas_vidon": subtenas_vidon,
                        "stato": self.sano_de_modeloj.get(nomo, "Preta (Sana)")
                    }
                    listo_de_detaloj.append(detaloj)
            return listo_de_detaloj
        except Exception as e:
            print(f"Eraro dum lestado de detaloj: {e}")
            return []

    def listi_modelojn(self) -> list:
        """Liveras nur la nomojn de la modeloj por la selekt-skatolo.""" # Akiras liston de modelaj nomoj.
        modeloj = self.detaligi_modelojn()
        return [m["nomo"] for m in modeloj]

    def prepari_instruon(self, genro: str, vortaro: dict = None) -> str:
        """
        Konstruas la sisteman instrukcion laux la elektita genro kaj injektas la glosaron.
        """
        target_lang_name = self.lingvo_nomoj.get(self.cel_lingvo, "Esperanto")
        
        instruo_base = ( # Baza instrukcio por la tradukisto.
            f"VI ESTAS PROFESIA TRADUKISTO AL {target_lang_name.upper()}\n"
            f"VIA CELO: Traduki la tekston al eleganta, akademia, literara kaj flua {target_lang_name}.\n"
            "STILO-REGULOJ:\n"
            "- Konservu HTML-etikedojn netusxitaj. Ne traduku ene de < >.\n"
            "- Liveru NUR la tradukitu HTML-kodon, sen klarigoj.\n"
        )
        
        if self.cel_lingvo == "eo":
            instruo_base = instruo_base.replace("STILO-REGULOJ:\n", "STILO-REGULOJ:\n- Uzu klasikan stilon (Zamenhofan).\n")

        stiloj = { # Vortaro de stiloj por malsamaj ĝenroj.
            "teologio": (
                "STILO: Biblia, solena kaj ekumena. REGLOJ: Uzu klasikan vortprovizon. "
                "1. Por REFORMITA: Uzu biblian simplecon. 2. Por KATOLIKA: Uzu latinidajn terminojn. "
                "3. Por ORTODOKSA: Preferu grek-devenajn terminojn. Uzu majusklojn por Diaj pronomoj (Li, Lia)."
            ),
            "akademia": (
                "STILO: Rigora, preciza, neŭtra kaj scienca. REGLOJ: Uzu pasivajn voĉojn por objektiveco; "
                "konservu teknikajn terminojn laŭ internaciaj sciencaj normoj."
            ),
            "fantasto": "STILO: Epika, evoka kaj atmosfera. REGLOJ: Uzu poeziajn metaforojn; kreu arkaikan senton.",
            "sciencfikcio": "STILO: Moderna, teknologia kaj futurisma. REGLOJ: Uzu la afiksojn de Esperanto por neologismoj.",
            "biografio": "STILO: Rakonta, intimeca kaj historia. REGLOJ: Fokusigu la psikologiajn nuancojn.",
            "poezio": "STILO: Lirika, ritma kaj belsona. REGLOJ: Prioritatu eŭfonion; permesu eliziojn.",
            "generala": f"STILO: Klara, ekvilibra kaj moderna. REGLOJ: Sekvu la 'Baza Literatura Standardo' por {target_lang_name}."
        }

        plena_instruo = f"{instruo_base}\n{stiloj.get(genro.lower(), stiloj['generala'])}"

        # Injekto de la Glosaro
        if vortaro:
            glosara_teksto = "\n\nGRAVA: Konservu cxi tiun terminologion (Glosaro):\n"
            for orig, trad in vortaro.items():
                glosara_teksto += f"- '{orig}' -> '{trad}'\n"
            plena_instruo += glosara_teksto

        return plena_instruo

    def traduki_blokon(self, teksto: str, genro: str, vortaro: dict = None, retestoj: int = 5, **kwargs) -> str:
        """Tradukas blokon de teksto uzante la glosaron se disponebla."""
        instruo = self.prepari_instruon(genro, vortaro)
        plena_prompto = f"{instruo}\n\nJEN LA TEKSTO POR TRADUKI:\n{teksto}" # La plena instrukcio por la modelo.
        
        for provo in range(retestoj):
            try:
                response = self.client.models.generate_content(
                    model=self.modelo_nomo,
                    contents=plena_prompto
                )
                
                if not response or not response.text:
                    continue
                
                self.sano_de_modeloj[self.modelo_nomo] = "Sana" # Ĝisdatigas la sanstaton de la modelo.
                return response.text
            
            except Exception as e:
                eraro_msg = str(e).upper()
                
                if "429" in eraro_msg:
                    self.sano_de_modeloj[self.modelo_nomo] = "Limo Atingita (429)"
                    atendo = 65 + (provo * 10) 
                    time.sleep(atendo)
                elif "404" in eraro_msg:
                    self.sano_de_modeloj[self.modelo_nomo] = "Modelo ne trovita (404)"
                    return f"Eraro: Modelo {self.modelo_nomo} ne trovita."
                else:
                    self.sano_de_modeloj[self.modelo_nomo] = f"Eraro: {str(e)[:20]}..."
                    time.sleep(10)
                    
        return "Eraro: Ne eblis traduki post pluraj provoj."