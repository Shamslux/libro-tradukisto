import streamlit as st
import os
import json
import pandas as pd
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from kerno.epub_traktilo import EpubTraktilo
from kerno.gemini_kliento import GeminiKliento
from kerno.google_free_kliento import GoogleFreeKliento
from kerno.tradukisto import Tradukisto

# ==========================================
# LOKA ĜISDATIGO 
# ==========================================
FALLBACK_LINGVOJ = {
    "eo": {
        "cxefa": { "titolo": "📚 LibroTradukisto" },
        "flanka_menuo": {
            "lingvo_titolo": "Lingvo / Language / Idioma:",
            "agordoj": "⚙️ Agordoj", "refresxi": "🔄 Ĝisdatigi Vidon (Refresh)",
            "elektu_motoron": "Elektu la traduk-motoron:", "modelo": "Modelo:", "genro": "Genro (Stilo):"
        },
        "eraroj": {
            "api_kontrolo": "Eraro ĉe API-kontrolo: {}", "api_mankas": "Enigu API-shlosilon!",
            "kapitolo_mankas": "Bonvolu elekti almenaŭ unu kapitolon!", "alshutu_unue": "⬆️ Bonvolu alŝuti EPUB-dosieron por komenci."
        },
        "taboj": {
            "tradukado": "📖 Tradukado", "redaktilo": "✍️ Redaktilo",
            "kasxo": "🧹 Kaŝmemoro (JSON)", "statuso": "📊 Statuso de Modeloj"
        },
        "tab_tradukado": {
            "alshutu": "Alshutu vian EPUB-libron", "analizi_btn": "📊 Analizi Strukturon kaj Progreson",
            "analizante_spin": "Analizante...", "stato_titolo": "🏁 Aktuala Stato de la Kapitoloj",
            "elektu_kapitolojn": "Elektu kapitolojn por traduki:", "metriko_mankantaj": "Mankantaj Blokoj",
            "metriko_tempo": "Tempo (Estimata)", "metriko_tempo_unuo": "{} min", "metriko_loka": "Loka Kasxo",
            "metriko_blokoj_unuo": "{} blokoj", "antaurigardo_titolo": "📖 Antaŭrigardo de Originala Enhavo",
            "enhavo_netrovita": "Enhavo ne trovita.", "viva_monitoro": "👁️ Viva Monitoro",
            "fonto": "Fonto: {}", "agoj_titolo": "🛠️ Agoj", "generi_el_kasxo_btn": "🛠️ GENERI EPUB EL KASXO",
            "konstruante_spin": "Konstruante...", "preta_toast": "Preta!", "daurigi_btn": "🚀 DAŬRIGI / KOMENCI TRADUKON",
            "elsuti_finan_btn": "📥 ELŜUTI FINAN LIBRON (EPUB)"
        },
        "tab_redaktilo": {
            "titolo": "✍️ Mana Redaktado", "vido_makro": "🚦 Statuso de la Kapitoloj (Vido Makro)",
            "finitaj": "### ✅ Finitaj", "neniu_plena": "Neniu plena.",
            "partaj": "### 🟡 Partaj", "tradukita_procento": "{}% tradukita", "parta_progreso": "Parta progreso",
            "neniu_parta": "Neniu parta.", "mankantaj": "### 🔴 Mankantaj", "neniu_mankanta": "Neniu mankanta.",
            "elektu_por_redakti": "🎯 Elektu kapitolon por redakti detalojn:",
            "rapida_supervido": "### 📊 Rapida Supervido de: {}",
            "progreson": "**Progreson en ĉi tiu kapitolo:** {} el {} blokoj ({}%)",
            "filtro_titolo": "Filtri blokojn:", "filtro_cxiuj": "Ĉiujn blokojn",
            "filtro_netradukitaj": "Nur netradukitajn", "filtro_tradukitaj": "Nur tradukitajn",
            "bloko": "Bloko {}", "tradukita": "(Tradukita)", "originala": "(Originala)",
            "redaktu_helpo": "💡 Redaktu la HTML-blokon sube (konservu la etikedojn / mantenha as tags HTML):",
            "enhavo_html": "Enhavo (HTML)", "konservi_sxangxojn_btn": "💾 Konservi Ŝanĝojn",
            "sukceso_konservita": "Bloko {} konservita!", "viva_antaurigardo": "👁️ Viva Antaŭrigardo (Renderizado)",
            "generi_libron_titolo": "📦 Generi Libron", "generi_kun_manaj_btn": "🛠️ GENERI EPUB KUN MANAJ REDAKTOJ",
            "elsuti_redaktitan_btn": "📥 ELŜUTI REDAKTITAN LIBRON"
        },
        "tab_kasxo": {
            "titolo": "🧹 Administri Kaŝmemoron (JSON)", "info_forigi": "Ĉi tie vi povas forigi tradukitajn blokojn.",
            "ekzistas_blokoj": "Ekzistas **{}** konservitaj blokoj.", "elektu_restarigi": "Elektu blokojn por restarigi (Reset):",
            "forigi_elektitajn_btn": "🗑️ Forigi Elektitajn Blokojn", "sukceso_forigita": "Forigita!",
            "dangxera_zono": "⚠️ Danĝera Zono: Nuligi Ĉion", "forigi_cxiom_btn": "💣 Forigi la tutan JSON-dosieron",
            "neniu_traduko": "Neniu traduko ankoraŭ komenciĝis."
        },
        "tab_statuso": {
            "titolo": "🤖 Teknikaj Detaloj de Gemini", "tabelo_nomo": "Nomo", "tabelo_versio": "Versio",
            "tabelo_limo_en": "Limo En (Tokens)", "tabelo_limo_el": "Limo El (Tokens)",
            "tabelo_vidkapablo": "Vidkapablo", "tabelo_stato": "Stato", "info_mankas_api": "Bonvolu enigi API-ŝlosilon."
        }
    }
}

def sxargxi_lingvojn():
    try:
        with open("lingvoj/lingvoj.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return FALLBACK_LINGVOJ

LINGVOJ_DATA = sxargxi_lingvojn()

# 1. Agordoj kaj Inicialigo
load_dotenv()
st.set_page_config(page_title="LibroTradukisto", page_icon="📚", layout="wide")

# Inicialigo de la seanca stato
if 'nuna_lingvo' not in st.session_state:
    st.session_state.nuna_lingvo = "eo"
if 'analizo_farita' not in st.session_state:
    st.session_state.analizo_farita = False
if 'statistikoj' not in st.session_state:
    st.session_state.statistikoj = None
if 'originala_enhavo_cache' not in st.session_state:
    st.session_state.originala_enhavo_cache = {}
if 'traduko_preta' not in st.session_state:
    st.session_state.traduko_preta = None 
if 'disponeblaj_modeloj_detalaj' not in st.session_state:
    st.session_state.disponeblaj_modeloj_detalaj = []
if 'lasta_dosiero_nomo' not in st.session_state:
    st.session_state.lasta_dosiero_nomo = None

def t(sxlosilo_pado, *args):
    """Funciio por serĉi la tekston en la nuna lingvo."""
    vojoj = sxlosilo_pado.split(".")
    aktuala = LINGVOJ_DATA.get(st.session_state.nuna_lingvo, FALLBACK_LINGVOJ["eo"])
    for v in vojoj:
        if isinstance(aktuala, dict):
            aktuala = aktuala.get(v, sxlosilo_pado)
        else:
            aktuala = sxlosilo_pado
            break
    
    if args and isinstance(aktuala, str):
        try:
            return aktuala.format(*args)
        except IndexError:
            return aktuala
    return aktuala

# CSS
EREADER_STYLE = """
<style>
    .epub-view { background-color: #fdf6e3; color: #5b4636; padding: 40px; border-radius: 10px; border: 1px solid #d3af8e; font-family: 'Georgia', serif; line-height: 1.6; height: 400px; overflow-y: auto; box-shadow: inset 0 0 10px rgba(0,0,0,0.1); }
    .preview-box { background-color: #ffffff; padding: 20px; border: 1px dashed #d3af8e; border-radius: 8px; margin-top: 10px; color: #333; font-family: 'Georgia', serif; }
    .badge { padding: 4px 8px; border-radius: 4px; color: white; font-size: 0.8em; font-weight: bold; margin-right: 5px; }
    .verda { background-color: #28a745; }
    .flava { background-color: #ffc107; color: black; }
    .ruga { background-color: #dc3545; }
    .lingvo-btn { margin-right: 10px; border: none; background: transparent; cursor: pointer; }
</style>
"""
st.markdown(EREADER_STYLE, unsafe_allow_html=True)

st.title(t('cxefa.titolo'))

# --- SIDEBAR: AGORDOJ ---
with st.sidebar:
    st.write(f"**🌐 {t('Lingvoj / Languages / Idiomas')}**")

    import base64
    def get_image_base64(path):
        if os.path.exists(path):
            with open(path, "rb") as f:
                data = f.read()
            return base64.b64encode(data).decode()
        return None

    lingv_agordoj = [
        {"id": "eo", "nomo": "Esperanto", "dosiero": "lingvoj/flagoj/esperanta_flago.png"},
        {"id": "pt", "nomo": "Português", "dosiero": "lingvoj/flagoj/brazila_flago.png"},
        {"id": "en", "nomo": "English", "dosiero": "lingvoj/flagoj/usona_flago.png"},
        {"id": "es", "nomo": "Español", "dosiero": "lingvoj/flagoj/argentina_flago.png"}, 
        {"id": "zh", "nomo": "中文", "dosiero": "lingvoj/flagoj/cxina_flago.png"},
        {"id": "fr", "nomo": "Français", "dosiero": "lingvoj/flagoj/franca_flago.png"},
        {"id": "de", "nomo": "Deutsch", "dosiero": "lingvoj/flagoj/germana_flago.png"},
        {"id": "ru", "nomo": "Русский", "dosiero": "lingvoj/flagoj/rusa_flago.png"}
    ]

    query_params = st.query_params
    if "lang" in query_params:
        nova_lingvo = query_params["lang"]
        if nova_lingvo != st.session_state.nuna_lingvo:
            st.session_state.nuna_lingvo = nova_lingvo
            st.rerun()


    cols = st.columns(4) 
    for idx, l in enumerate(lingv_agordoj):
        with cols[idx % 4]:
            b64 = get_image_base64(l["dosiero"])
            if b64:
                st.markdown(
                    f"""
                    <a href="/?lang={l['id']}" target="_self">
                        <img src="data:image/png;base64,{b64}" width="45" style="border-radius: 50%; border: {'2px solid #28a745' if st.session_state.nuna_lingvo == l['id'] else 'none'};">
                    </a>
                    <p style="font-size: 10px; text-align: center;">{l['nomo']}</p>
                    """,
                    unsafe_allow_html=True
                )
            else:
                if st.button(l["id"].upper(), key=f"btn_fallback_{l['id']}"):
                    st.session_state.nuna_lingvo = l["id"]
                    st.rerun()
        
    st.divider()

    st.header(t('flanka_menuo.agordoj')) 
    
    if st.button(t('flanka_menuo.refresxi'), use_container_width=True):
        st.rerun()
        
    st.divider()
    
    motoro_elekto = st.radio(
        t('flanka_menuo.elektu_motoron'),
        ["Gemini AI (Oficiala)", "Google Free (Senpaga/GTX)"]
    )
    
    api_key = ""
    modelo_nomo = "gemini-2.0-flash"
    
    if "Gemini" in motoro_elekto:
        default_key = os.getenv("GEMINI_API_KEY", "")
        api_key = st.text_input("Gemini API Key", value=default_key, type="password")
        
        if api_key:
            try:
                if not st.session_state.disponeblaj_modeloj_detalaj:
                    with st.spinner(t('tab_tradukado.analizante_spin')):
                        temp_kliento = GeminiKliento(api_shlosilo=api_key)
                        st.session_state.disponeblaj_modeloj_detalaj = temp_kliento.detaligi_modelojn()
                
                modeloj_listo = [m["nomo"] for m in st.session_state.disponeblaj_modeloj_detalaj]
                def_idx = 0
                for idx, m in enumerate(modeloj_listo):
                    if "flash" in m.lower():
                        def_idx = idx
                        break
                modelo_nomo = st.selectbox(t('flanka_menuo.modelo'), modeloj_listo, index=def_idx)
            except Exception as e:
                st.error(t('eraroj.api_kontrolo', e))
    
    genro = st.selectbox(t('flanka_menuo.genro'), 
                         ["Generala", "Teologio", "Akademia", "Fantasto", "Sciencfikcio", "Biografio", "Poezio"])

def inicialigi_tradukiston(dosiero_nomo, dosiero_obj=None):
    temp_path = f"temp_{dosiero_nomo}"
    if dosiero_obj is not None:
        with open(temp_path, "wb") as f:
            f.write(dosiero_obj.getbuffer())

    if not os.path.exists(temp_path):
        return None

    if "Gemini" in motoro_elekto:
        kliento = GeminiKliento(api_shlosilo=api_key, modelo_nomo=modelo_nomo)
    else:
        kliento = GoogleFreeKliento()
    
    traktilo = EpubTraktilo(temp_path)
    return Tradukisto(kliento, traktilo)

alsutita_dosiero = st.file_uploader(t('tab_tradukado.alshutu'), type=["epub"], key="main_upl")

if alsutita_dosiero:
    st.session_state.lasta_dosiero_nomo = alsutita_dosiero.name
    motoro = inicialigi_tradukiston(alsutita_dosiero.name, alsutita_dosiero)
elif 'lasta_dosiero_nomo' in st.session_state:
    motoro = inicialigi_tradukiston(st.session_state.lasta_dosiero_nomo)
else:
    motoro = None

if motoro:
    tab_cxefa, tab_redaktilo, tab_kasxo, tab_statuso = st.tabs([
        t('taboj.tradukado'), 
        t('taboj.redaktilo'), 
        t('taboj.kasxo'), 
        t('taboj.statuso')
    ])

    # --- TAB 1: TRADUKADO ---
    with tab_cxefa:
        if st.button(t('tab_tradukado.analizi_btn')):
            with st.spinner(t('tab_tradukado.analizante_spin')):
                stats = motoro.estimi_laboron()
                st.session_state.statistikoj = stats
                cache = {k.get_name(): k.get_content().decode("utf-8") for k in motoro.traktilo.elstiri_tekston()}
                st.session_state.originala_enhavo_cache = cache
                st.session_state.analizo_farita = True

        if st.session_state.analizo_farita and st.session_state.statistikoj:
            stats = st.session_state.statistikoj
            st.divider()
            st.subheader(t('tab_tradukado.stato_titolo'))
            c1, c2, c3 = st.columns(3)
            with c1:
                for v in [d['nomo'] for d in stats['detaloj'] if d['stato'] == 'verda']:
                    st.markdown(f"<span class='badge verda'>{v}</span>", unsafe_allow_html=True)
            with c2:
                for f in [d['nomo'] for d in stats['detaloj'] if d['stato'] == 'flava']:
                    st.markdown(f"<span class='badge flava'>{f}</span>", unsafe_allow_html=True)
            with c3:
                for r in [d['nomo'] for d in stats['detaloj'] if d['stato'] == 'ruĝa']:
                    st.markdown(f"<span class='badge ruga'>{r}</span>", unsafe_allow_html=True)

            st.divider()
            chiuj_nomoj = [d['nomo'] for d in stats['detaloj']]
            defauxlta_selekto = [d['nomo'] for d in stats['detaloj'] if d['stato'] != 'verda']
            elektitaj = st.multiselect(t('tab_tradukado.elektu_kapitolojn'), chiuj_nomoj, default=defauxlta_selekto)

            col_m1, col_m2, col_m3 = st.columns(3)
            restantaj = stats['entute_blokoj'] - stats['jam_faritaj']
            col_m1.metric(t('tab_tradukado.metriko_mankantaj'), restantaj)
            col_m2.metric(t('tab_tradukado.metriko_tempo'), t('tab_tradukado.metriko_tempo_unuo', stats['estimata_tempo_min']))
            col_m3.metric(t('tab_tradukado.metriko_loka'), t('tab_tradukado.metriko_blokoj_unuo', stats['jam_faritaj']))

            st.divider()
            st.subheader(t('tab_tradukado.antaurigardo_titolo'))
            for detalo in stats['detaloj']:
                ikono = "✅" if detalo['stato'] == 'verda' else "🟡" if detalo['stato'] == 'flava' else "🔴"
                with st.expander(f"{ikono} {detalo['nomo']} ({detalo['blokoj']} blokoj)"):
                    html_orig = st.session_state.originala_enhavo_cache.get(detalo['nomo'], t('tab_tradukado.enhavo_netrovita'))
                    st.markdown(f'<div class="epub-view">{html_orig}</div>', unsafe_allow_html=True)

            st.divider()
            st.subheader(t('tab_tradukado.viva_monitoro'))
            col_orig, col_trad = st.columns(2)
            box_orig, box_trad = col_orig.empty(), col_trad.empty()

            def viva_monitoro(nomo, trad):
                box_orig.info(t('tab_tradukado.fonto', nomo))
                box_trad.markdown(f'<div class="epub-view" style="background-color: #eef7ee;">{trad}</div>', unsafe_allow_html=True)

            st.divider()
            st.subheader(t('tab_tradukado.agoj_titolo'))
            cb1, cb2 = st.columns(2)
            with cb1:
                if st.button(t('tab_tradukado.generi_el_kasxo_btn')):
                    with st.spinner(t('tab_tradukado.konstruante_spin')):
                        libro_kasxo = motoro.generi_epub_el_kasxo()
                        st.session_state.traduko_preta = motoro.konservi(libro_kasxo, st.session_state.lasta_dosiero_nomo)
                        st.toast(t('tab_tradukado.preta_toast'), icon="✅")
            with cb2:
                if st.button(t('tab_tradukado.daurigi_btn')):
                    if "Gemini" in motoro_elekto and not api_key:
                        st.error(t('eraroj.api_mankas'))
                    elif not elektitaj:
                        st.error(t('eraroj.kapitolo_mankas'))
                    else:
                        prog = st.progress(0)
                        stat_txt = st.empty()
                        tradukita = motoro.traduki_libron(genro, elektitaj, 
                                                         lambda p, tx: (prog.progress(p), stat_txt.text(tx)), viva_monitoro)
                        st.session_state.traduko_preta = motoro.konservi(tradukita, st.session_state.lasta_dosiero_nomo)
                        st.balloons()

            if st.session_state.traduko_preta:
                st.divider()
                with open(st.session_state.traduko_preta, "rb") as f:
                    st.download_button(t('tab_tradukado.elsuti_finan_btn'), f, f"eo_{st.session_state.lasta_dosiero_nomo}", "application/epub+zip")

    # --- TAB 2: MANA REDAKTADO ---
    with tab_redaktilo:
        st.header(t('tab_redaktilo.titolo'))
        
        motoro_red = motoro
        kasxmemoro = motoro_red._sxargxi_kasxmemoron()
        
        if not st.session_state.analizo_farita or st.session_state.statistikoj is None:
            with st.spinner(t('tab_tradukado.analizante_spin')):
                st.session_state.statistikoj = motoro_red.estimi_laboron()
                st.session_state.analizo_farita = True
        
        stats = st.session_state.statistikoj

        st.subheader(t('tab_redaktilo.vido_makro'))
        col_v, col_f, col_r = st.columns(3)
        
        with col_v:
            st.markdown(t('tab_redaktilo.finitaj'))
            finitaj = [d['nomo'] for d in stats['detaloj'] if d['stato'] == 'verda']
            if finitaj:
                for f in finitaj: st.success(f"**{f}**")
            else:
                st.write(t('tab_redaktilo.neniu_plena'))

        with col_f:
            st.markdown(t('tab_redaktilo.partaj'))
            partaj = [d for d in stats['detaloj'] if d['stato'] == 'flava']
            if partaj:
                for p in partaj: 
                    st.warning(f"**{p['nomo']}**")
                    if 'procento' in p:
                        st.caption(t('tab_redaktilo.tradukita_procento', p['procento']))
                    else:
                        st.caption(t('tab_redaktilo.parta_progreso'))
            else:
                st.write(t('tab_redaktilo.neniu_parta'))

        with col_r:
            st.markdown(t('tab_redaktilo.mankantaj'))
            mankantaj = [d['nomo'] for d in stats['detaloj'] if d['stato'] == 'ruĝa']
            if mankantaj:
                for m in mankantaj: st.error(f"**{m}**")
            else:
                st.write(t('tab_redaktilo.neniu_mankanta'))

        st.divider()

        if not st.session_state.originala_enhavo_cache:
            st.session_state.originala_enhavo_cache = {k.get_name(): k.get_content().decode("utf-8") for k in motoro_red.traktilo.elstiri_tekston()}
        
        kapitoloj_listo = list(st.session_state.originala_enhavo_cache.keys())
        elektita_kap = st.selectbox(t('tab_redaktilo.elektu_por_redakti'), kapitoloj_listo)

        if elektita_kap:
            html_orig_plena = st.session_state.originala_enhavo_cache[elektita_kap]
            blokoj_orig = motoro_red.traktilo.dividi_en_blokojn(html_orig_plena, platigi=("Google" in motoro_elekto))
            
            st.write(t('tab_redaktilo.rapida_supervido', elektita_kap))
            
            progreso_html = ""
            faritaj = 0
            for i in range(len(blokoj_orig)):
                shl = f"{elektita_kap}_{i}"
                if shl in kasxmemoro:
                    progreso_html += f"<span title='Bloko {i}' style='color:#28a745; font-size:20px; margin-right:5px;'>▣</span>"
                    faritaj += 1
                else:
                    progreso_html += f"<span title='Bloko {i}' style='color:#ccc; font-size:20px; margin-right:5px;'>□</span>"
            
            st.markdown(f"<div style='background:#f0f2f6; padding:15px; border-radius:10px; margin-bottom:20px;'>{progreso_html}</div>", unsafe_allow_html=True)
            
            percent = int(faritaj/len(blokoj_orig)*100) if len(blokoj_orig) > 0 else 0
            st.write(t('tab_redaktilo.progreson', faritaj, len(blokoj_orig), percent))
            
            filtro = st.radio(t('tab_redaktilo.filtro_titolo'), [t('tab_redaktilo.filtro_cxiuj'), t('tab_redaktilo.filtro_netradukitaj'), t('tab_redaktilo.filtro_tradukitaj')], horizontal=True)
            st.divider()

            for idx, bloko_raw in enumerate(blokoj_orig):
                shlosilo = f"{elektita_kap}_{idx}"
                estas_tradukita = shlosilo in kasxmemoro
                
                if filtro == t('tab_redaktilo.filtro_netradukitaj') and estas_tradukita: continue
                if filtro == t('tab_redaktilo.filtro_tradukitaj') and not estas_tradukita: continue

                nuna_enhavo = kasxmemoro.get(shlosilo, bloko_raw)
                ikono_stato = "✅" if estas_tradukita else "⚪"
                stato_teksto = t('tab_redaktilo.tradukita') if estas_tradukita else t('tab_redaktilo.originala')
                
                with st.expander(f"{ikono_stato} {t('tab_redaktilo.bloko', idx)} {stato_teksto}"):
                    col_edit, col_prev = st.columns([0.6, 0.4])
                    
                    with col_edit:
                        with st.form(f"form_red_{shlosilo}"):
                            st.caption(t('tab_redaktilo.redaktu_helpo'))
                            
                            nova_enhavo = st.text_area(
                                t('tab_redaktilo.enhavo_html'), 
                                value=nuna_enhavo, 
                                height=250, 
                                key=f"inp_{shlosilo}"
                            )
                            
                            if st.form_submit_button(t('tab_redaktilo.konservi_sxangxojn_btn')):
                                kasxmemoro[shlosilo] = nova_enhavo
                                motoro_red._konservi_kasxmemoron(kasxmemoro)
                                st.session_state.statistikoj = motoro_red.estimi_laboron()
                                st.toast(t('tab_redaktilo.sukceso_konservita', idx), icon="✅")
                                st.rerun()

                    with col_prev:
                        st.caption(t('tab_redaktilo.viva_antaurigardo'))
                        st.markdown(f'<div class="preview-box">{nuna_enhavo}</div>', unsafe_allow_html=True)

            st.divider()
            st.subheader(t('tab_redaktilo.generi_libron_titolo'))
            if st.button(t('tab_redaktilo.generi_kun_manaj_btn'), key="gen_red_btn"):
                with st.spinner(t('tab_tradukado.konstruante_spin')):
                    libro_finala = motoro_red.generi_epub_el_kasxo()
                    vojo_finala = motoro_red.konservi(libro_finala, st.session_state.lasta_dosiero_nomo)
                    
                    with open(vojo_finala, "rb") as f:
                        st.download_button(
                            t('tab_redaktilo.elsuti_redaktitan_btn'), 
                            f, 
                            f"redaktita_{st.session_state.lasta_dosiero_nomo}", 
                            "application/epub+zip", 
                            key="download_red_btn"
                        )

    # --- TAB 3: KAŜMEMORA MANAĜILO (JSON) ---
    with tab_kasxo:
        st.header(t('tab_kasxo.titolo'))
        st.info(t('tab_kasxo.info_forigi'))
        
        vojo_json = os.path.join("eliroj", "progres-konservo.json")
        if os.path.exists(vojo_json):
            with open(vojo_json, "r", encoding="utf-8") as f:
                try: nuna_kasxo = json.load(f)
                except: nuna_kasxo = {}
            
            if nuna_kasxo:
                st.write(t('tab_kasxo.ekzistas_blokoj', len(nuna_kasxo)))
                blokoj_por_forigi = st.multiselect(t('tab_kasxo.elektu_restarigi'), sorted(list(nuna_kasxo.keys())))
                
                if st.button(t('tab_kasxo.forigi_elektitajn_btn'), type="primary"):
                    if blokoj_por_forigi:
                        for b in blokoj_por_forigi: del nuna_kasxo[b]
                        with open(vojo_json, "w", encoding="utf-8") as f:
                            json.dump(nuna_kasxo, f, ensure_ascii=False, indent=2)
                        st.success(t('tab_kasxo.sukceso_forigita'))
                        st.rerun()
                
                st.divider()
                with st.expander(t('tab_kasxo.dangxera_zono')):
                    if st.button(t('tab_kasxo.forigi_cxiom_btn')):
                        os.remove(vojo_json)
                        st.rerun()
        else:
            st.write(t('tab_kasxo.neniu_traduko'))

    # --- TAB 4: STATUSO ---
    with tab_statuso:
        st.subheader(t('tab_statuso.titolo'))
        if api_key:
            try:
                kliento_status = GeminiKliento(api_shlosilo=api_key)
                detaloj = kliento_status.detaligi_modelojn()
                if detaloj:
                    df = pd.DataFrame(detaloj)
                    df.columns = [
                        t('tab_statuso.tabelo_nomo'), t('tab_statuso.tabelo_versio'), 
                        t('tab_statuso.tabelo_limo_en'), t('tab_statuso.tabelo_limo_el'), 
                        t('tab_statuso.tabelo_vidkapablo'), t('tab_statuso.tabelo_stato')
                    ]
                    st.dataframe(df, use_container_width=True, hide_index=True)
            except Exception as e:
                st.error(t('eraroj.api_kontrolo', e))
        else:
            st.info(t('tab_statuso.info_mankas_api'))
else:
    st.info(t('eraroj.alshutu_unue'))