from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, KeepTogether, HRFlowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PILImage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/Alabanza-REAPER-Guia-visual.pdf'
SHOTS = Path('/var/folders/nm/k59ghmnn4c57s1qcgl3vx6lh0000gn/T')
FONT = Path('/Users/edisonaular/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype/DejaVuSans.ttf')
pdfmetrics.registerFont(TTFont('DejaVu', str(FONT)))
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleX', fontName='DejaVu', fontSize=23, leading=28, textColor=colors.HexColor('#102033'), spaceAfter=5))
styles.add(ParagraphStyle(name='SubX', fontName='DejaVu', fontSize=10, leading=15, textColor=colors.HexColor('#536477'), spaceAfter=12))
styles.add(ParagraphStyle(name='H2X', fontName='DejaVu', fontSize=15, leading=19, textColor=colors.HexColor('#102033'), spaceBefore=3, spaceAfter=8))
styles.add(ParagraphStyle(name='BodyX', fontName='DejaVu', fontSize=9, leading=13.2, textColor=colors.HexColor('#28394b'), spaceAfter=5))
styles.add(ParagraphStyle(name='SmallX', fontName='DejaVu', fontSize=7.5, leading=10.5, textColor=colors.HexColor('#617287'), spaceAfter=2))
styles.add(ParagraphStyle(name='CallX', fontName='DejaVu', fontSize=9, leading=13, textColor=colors.HexColor('#12324a'), backColor=colors.HexColor('#eef7ff'), borderColor=colors.HexColor('#b9ddff'), borderWidth=.7, borderPadding=8, spaceBefore=5, spaceAfter=7))
styles.add(ParagraphStyle(name='StepX', fontName='DejaVu', fontSize=9.2, leading=13.4, textColor=colors.HexColor('#28394b'), leftIndent=14, firstLineIndent=-14, spaceAfter=5))

def footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setStrokeColor(colors.HexColor('#dce5ed'))
    canvas.line(18*mm, 15*mm, w-18*mm, 15*mm)
    canvas.setFont('DejaVu', 7)
    canvas.setFillColor(colors.HexColor('#718096'))
    canvas.drawString(18*mm, 10*mm, 'ALABANZA  ·  GUÍA DE REAPER')
    canvas.drawRightString(w-18*mm, 10*mm, f'{doc.page}')
    canvas.restoreState()

def fit_image(path, maxw, maxh):
    with PILImage.open(path) as im:
        w, h = im.size
    scale = min(maxw/w, maxh/h)
    return Image(str(path), width=w*scale, height=h*scale, hAlign='CENTER')

def page_head(kicker, title, desc):
    return [Paragraph(kicker.upper(), ParagraphStyle('Kicker'+title, parent=styles['SmallX'], textColor=colors.HexColor('#0878ce'), fontName='DejaVu', fontSize=8.5, leading=11, spaceAfter=4)), Paragraph(title, styles['TitleX']), Paragraph(desc, styles['SubX']), HRFlowable(width='100%', thickness=.7, color=colors.HexColor('#dce5ed'), spaceAfter=10)]

story=[]
story += page_head('Preparar el multitrack', 'Tres pasos, una canción a la vez', 'Este proceso calibra el mapa de secciones del multitrack. La canción y sus letras originales permanecen intactas.')
story.append(Paragraph('<b>1 · Descarga.</b> En Administración → REAPER, elige la canción y pulsa <b>Descargar proyecto + stems</b>. Descomprime el ZIP completo y abre <b>- revisar.RPP</b>; deja la carpeta Media junto al proyecto.', styles['BodyX']))
story.append(Paragraph('<b>2 · Comprueba el pulso.</b> La pista Click está alineada al inicio del proyecto. Escucha Click con la mezcla y confirma el compás. El BPM del catálogo es una referencia: la medición en REAPER debe prevalecer.', styles['BodyX']))
story.append(fit_image(SHOTS/'codex-clipboard-a136a0ea-7946-4567-a024-b165abeff753.png', 174*mm, 105*mm))
story.append(Paragraph('En la regla superior se ven compases y tiempos; la onda Click permite comparar los golpes con la música. No cambies la velocidad ni desplaces los stems.', styles['SmallX']))
story.append(Paragraph('<b>Si aún no registraste el asistente:</b> Actions → Show action list → New action → Load ReaScript. Carga <i>Alabanza-Asistente.lua</i>, selecciónalo y pulsa Run. No requiere plugins adicionales.', styles['CallX']))
story.append(PageBreak())

story += page_head('Ajustar tempo y secciones', 'Usa referencias musicales exactas', 'El asistente guarda la posición exacta del cursor. La precisión depende de ubicarlo sobre el primer pulso correcto.')
story.append(Paragraph('<b>3 · UNO y tempo.</b> Coloca el cursor en el primer pulso real del compás 1 y pulsa <b>Marcar UNO aquí</b>. Para medir, selecciona desde un UNO hasta otro UNO posterior y cuenta compases completos. Del compás 1 al inicio del 9 hay 8 compases; para 4/4 introduce <b>8, 4, 4</b> al pulsar Medir tempo.', styles['BodyX']))
story.append(Paragraph('<b>4 · Entradas.</b> Recorre cada marcador. Escucha el cambio, detén el transporte, coloca el cursor en el primer tiempo de la sección y pulsa <b>Enter</b> (Confirmar … aquí). Si falta una, elige su tipo en el grupo <b>Sección</b> y pulsa <b>Añadir</b>; los avisos hablados (Sube intensidad, Hits…) van en el grupo <b>Instrucción</b> y no crean secciones.', styles['BodyX']))
story.append(fit_image(SHOTS/'codex-clipboard-81096a7c-c7a5-4826-8b16-d30c17406cf3.png', 174*mm, 133*mm))
story.append(Paragraph('En la ventana del asistente: los cuatro pasos arriba muestran ✓ al completarse; la lista de la izquierda va a cada entrada; Espacio reproduce y detiene; Enter ejecuta la acción principal; UNO y FIN AUDIO son anclas técnicas; el paso Guardar abre Alabanza.', styles['SmallX']))
story.append(Paragraph('<b>5 · Final.</b> FIN AUDIO va después de las colas audibles de todos los stems. El último golpe rítmico puede ocurrir antes. Revisa al principio, a mitad y al final; guarda con <b>Guardar RPP</b> o File → Save.', styles['CallX']))
story.append(PageBreak())

story += page_head('Volver a Alabanza', 'Revisar y aplicar el mapa', 'El RPP guardado todavía no actualiza el multitrack: el último paso es cargarlo, revisar el informe y aplicar.')
story.append(Paragraph('<b>6 · Sube el archivo.</b> En Administración → REAPER, conserva seleccionada la misma canción y pulsa <b>Elegir archivo .RPP</b>. No vuelvas a cargar los stems.', styles['BodyX']))
story.append(fit_image(SHOTS/'codex-clipboard-529a6956-b842-46c1-a2cf-e06f5b146a79.png', 174*mm, 92*mm))
story.append(Paragraph('Antes de subir, revisa las etiquetas y el orden de los marcadores. En la captura se distinguen entradas de sección, Final y FIN AUDIO; los marcadores de borrador deben confirmarse o quitarse en REAPER.', styles['SmallX']))
story.append(Spacer(1, 3*mm))
story.append(Paragraph('<b>7 · Revisa y aplica.</b> Lee las alertas y las diferencias de tiempo. Corrige en REAPER cualquier bloqueo, guarda y vuelve a subir. Desmarca las secciones que no quieras usar y pulsa <b>Aplicar mapa al multitrack</b>. Después, vuelve a abrir la canción en Live Director.', styles['BodyX']))
story.append(Paragraph('La aplicación modifica únicamente el mapa de la sesión multitrack. No cambia la canción original, las letras, los acordes ni los arreglos de eventos.', styles['CallX']))
story.append(Paragraph('<b>Nota:</b> si hay un cambio real de tempo o compás dentro de la canción, conserva el mapa variable de REAPER; no lo reemplaces por un BPM fijo. La comprobación automática encuentra errores estructurales, pero la exactitud musical se confirma escuchando.', styles['BodyX']))

doc=SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=16*mm, bottomMargin=20*mm, title='Guía visual REAPER · Alabanza', author='Alabanza')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
