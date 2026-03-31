import os
import json
import time
import re
import logging
from ebooklib import epub
from .epub_traktilo import EpubTraktilo

# Agordo de la LOG-sistemo (Telemetrio)
# Ĝi konservas en dosiero kaj ankaŭ montras en la terminalo
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("tradukado_detaloj.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)

class Tradukisto:
    def __init__(self, motoro, traktilo: EpubTraktilo, cel_lingvo: str = "eo"):
        """
        Iniciatas la tradukiston kun traduk-motoro kaj EPUB-traktilo.
        """
        self.motoro = motoro
        self.traktilo = traktilo
        self.dosierujo_eliroj = "eliroj"
        self.cel_lingvo = cel_lingvo
        self.kasxdosiero = os.path.join(self.dosierujo_eliroj, "progres-konservo.json")
        self.vojo_glosaro = "postuloj.txt"

    def _sxargxi_glosaron(self) -> dict:
        """
        Legas la dosieron postuloj.txt kaj kreas vortaron (dict).
        Formato: Originalo = Traduko
        """
        vortaro = {}
        if os.path.exists(self.vojo_glosaro):
            try:
                with open(self.vojo_glosaro, "r", encoding="utf-8") as f:
                    for linio in f:
                        linio = linio.strip()
                        if "=" in linio and not linio.startswith("#"):
                            orig, trad = linio.split("=", 1)
                            vortaro[orig.strip()] = trad.strip()
                logging.info(f"Glosaro sxargxita: {len(vortaro)} terminoj.")
            except Exception as e:
                logging.error(f"Eraro dum legado de glosaro: {e}")
        return vortaro

    def _verigi_integrecon(self, originala_html, tradukita_html):
        """
        Kontrolas cxu la strukturo de la HTML estis konservita.
        """
        tags_kritikaj = [r'<p\b', r'<div\b', r'<li\b', r'<h[1-6]\b', r'<blockquote\b']
        eraroj = []
        for tag_regex in tags_kritikaj:
            nombro_orig = len(re.findall(tag_regex, originala_html, re.IGNORECASE))
            nombro_trad = len(re.findall(tag_regex, tradukita_html, re.IGNORECASE))
            if nombro_orig != nombro_trad:
                tag_nomo = tag_regex.replace(r'\b', '').replace('<', '')
                eraroj.append(f"{tag_nomo}: {nombro_orig} != {nombro_trad}")
        
        if eraroj:
            return False, " | ".join(eraroj)
        return True, ""

    def estimi_laboron(self):
        """Analizas la libron kaj klasifikas kapitolojn laŭ progreso."""
        kasxmemoro = self._sxargxi_kasxmemoron()
        kapitoloj = self.traktilo.elstiri_tekston()
        entute_blokoj = 0
        jam_faritaj = 0
        detaloj_pri_kapitoloj = []

        for ero in kapitoloj:
            nomo = ero.get_name()
            html = ero.get_content().decode("utf-8")
            blokoj = self.traktilo.dividi_en_blokojn(html)
            nombro = len(blokoj)
            entute_blokoj += nombro
            kapitolo_faritaj = sum(1 for j in range(nombro) if f"{nomo}_{j}" in kasxmemoro)
            jam_faritaj += kapitolo_faritaj

            stato = "verda" if kapitolo_faritaj == nombro else "flava" if kapitolo_faritaj > 0 else "ruĝa"
            detaloj_pri_kapitoloj.append({"nomo": nomo, "blokoj": nombro, "faritaj": kapitolo_faritaj, "stato": stato})

        restantaj = entute_blokoj - jam_faritaj
        atendo = 4 if "3.1" in getattr(self.motoro, 'modelo_nomo', "") else 12
        return {
            "entute_blokoj": entute_blokoj,
            "jam_faritaj": jam_faritaj,
            "detaloj": detaloj_pri_kapitoloj,
            "estimata_tempo_min": (restantaj * atendo) // 60 if restantaj > 0 else 0
        }

    def _sxargxi_kasxmemoron(self):
        if os.path.exists(self.kasxdosiero):
            try:
                with open(self.kasxdosiero, "r", encoding="utf-8") as f: return json.load(f)
            except: return {}
        return {}

    def _konservi_kasxmemoron(self, datumoj):
        if not os.path.exists(self.dosierujo_eliroj): os.makedirs(self.dosierujo_eliroj)
        with open(self.kasxdosiero, "w", encoding="utf-8") as f:
            json.dump(datumoj, f, ensure_ascii=False, indent=2)

    def generi_epub_el_kasxo(self):
        kasxmemoro = self._sxargxi_kasxmemoron()
        kapitoloj = self.traktilo.elstiri_tekston()
        for kapitolo in kapitoloj:
            nomo = kapitolo.get_name()
            originala_html = kapitolo.get_content().decode("utf-8")
            blokoj = self.traktilo.dividi_en_blokojn(originala_html, platigi=False)
            enhavo = "".join(kasxmemoro.get(f"{nomo}_{i}", b) for i, b in enumerate(blokoj))
            kapitolo.set_content(enhavo.encode("utf-8"))
        return self.traktilo.libro

    def traduki_libron(self, genro: str, elektitaj_kapitoloj: list = None, progreso_callback=None, live_view_callback=None, cheki_interrompon=None):
        """Tradukas uzante QA, glosaron, logs kaj auxtomatan detekton de 'platigado'."""
        komenca_tempo = time.time()
        kasxmemoro = self._sxargxi_kasxmemoron()
        vortaro = self._sxargxi_glosaron()
        
        estas_google = "GoogleFree" in str(type(self.motoro))
        logging.info(f"Komencante tradukon. Motoro: {type(self.motoro).__name__} | Platigi: {estas_google}")
        
        kapitoloj = [k for k in self.traktilo.elstiri_tekston() if elektitaj_kapitoloj is None or k.get_name() in elektitaj_kapitoloj] # Filtritaj kapitoloj por traduki.
        
        # 1. Pré-calculamos o total global de blocos para a barra de progresso encher de forma realista
        total_blokoj_entute = 0
        kapitolo_blokoj_mapo = {}
        for kapitolo in kapitoloj:
            nomo = kapitolo.get_name()
            originala_html = kapitolo.get_content().decode("utf-8")
            blokoj = self.traktilo.dividi_en_blokojn(originala_html, platigi=estas_google)
            kapitolo_blokoj_mapo[nomo] = blokoj
            total_blokoj_entute += len(blokoj)
            
        blokoj_faritaj_entute = 0 # Nombro de blokoj jam tradukitaj.
        
        for i, kapitolo in enumerate(kapitoloj):
            if cheki_interrompon and cheki_interrompon():
                logging.info("Tradukado interrompita de la uzanto antaŭ la kapitolo.")
                break

            nomo = kapitolo.get_name()
            blokoj = kapitolo_blokoj_mapo[nomo]
            total_blokoj_nuna = len(blokoj)
            logging.info(f"Kapitolo {nomo}: {total_blokoj_nuna} blokoj procesotaj.")
            tradukita_html_listo = []

            for indekso, bloko in enumerate(blokoj):
                if cheki_interrompon and cheki_interrompon():
                    logging.info(f"Tradukado interrompita de la uzanto en la bloko {indekso}.")
                    return self.traktilo.libro 

                shlosilo = f"{nomo}_{indekso}"
                blokoj_faritaj_entute += 1

                # Ĝisdatigas la progreso-stangon (0.0 ĝis 1.0)
                if progreso_callback and total_blokoj_entute > 0:
                    progreso_nuna = blokoj_faritaj_entute / float(total_blokoj_entute)
                    # Trava de segurança para o Streamlit não quebrar caso passe de 1.0
                    progreso_nuna = min(1.0, max(0.0, progreso_nuna))
                    progreso_callback(progreso_nuna, f"Tradukante: {nomo} ({indekso + 1}/{total_blokoj_nuna})")

                if shlosilo in kasxmemoro:
                    rezulto = kasxmemoro[shlosilo]
                    fonto = " [KASXO]"
                    logging.info(f"  [{shlosilo}] Trovita en kasxo.")
                else:
                    start_bloko = time.time()
                    try:
                        # Voko al API
                        kruda_rezulto = self.motoro.traduki_blokon(bloko, genro, vortaro=vortaro, cel_lingvo=self.cel_lingvo)
                        fina_bloko_tempo = time.time() - start_bloko
                        
                        rezulto = kruda_rezulto.replace("```html", "").replace("```", "").strip()
                        
                        # QA-KONTROLO
                        estas_bona, eraro_msg = self._verigi_integrecon(bloko, rezulto)
                        if not estas_bona:
                            logging.warning(f"  [{shlosilo}] Struktura eraro detektita: {eraro_msg}")
                            rezulto = f"\n" + rezulto
                        
                        # Metrikoj de la bloko
                        logging.info(f"  [{shlosilo}] API Sukcesa: {fina_bloko_tempo:.2f}s | Grandeco In: {len(bloko)} / Out: {len(rezulto)}")
                        
                    except Exception as e:
                        logging.error(f"  [{shlosilo}] KRITIKA ERARO: {e}") # Rezerva solvo por ne perdi la libron.
                        rezulto = bloko # Fallback por ne perdi la libron

                    kasxmemoro[shlosilo] = rezulto
                    self._konservi_kasxmemoron(kasxmemoro)
                    fonto = ""
                    
                    if "Gemini" in str(type(self.motoro)):
                        atendo = 4 if "3.1" in getattr(self.motoro, 'modelo_nomo', "") else 12
                        time.sleep(atendo)
                
                tradukita_html_listo.append(rezulto)
                if live_view_callback:
                    viva_teksto = rezulto
                    if "ERARO DE INTEGRITO" in rezulto:
                        viva_teksto = f"<p style='color:red;'>⚠️ <b>STRUKTURA ERARO!</b></p>" + rezulto
                    live_view_callback(f"{nomo}{fonto}", viva_teksto)

            kapitolo.set_content("".join(tradukita_html_listo).encode("utf-8"))
        
        fina_tempo = (time.time() - komenca_tempo) / 60
        logging.info(f"Fino de la tradukado. Totala tempo: {fina_tempo:.2f} minutoj.")
        return self.traktilo.libro

    def konservi(self, libro, originala_nomo):
        if not os.path.exists(self.dosierujo_eliroj): os.makedirs(self.dosierujo_eliroj)
        vojo = os.path.join(self.dosierujo_eliroj, f"{self.cel_lingvo}_{os.path.basename(originala_nomo)}")
        epub.write_epub(vojo, libro)
        logging.info(f"Libro konservita: {vojo}")
        return vojo