"""Legacy proposal utilities; the executable entry now builds the approved coral identity."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import cairosvg
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import io
import shutil

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "brand"
BLUE, PAPER, INK, WHITE = "#3659E3", "#F5F4F0", "#20232D", "#FFFFFF"
SYMBOLS = {
    "a": '<rect x="12" y="12" width="16" height="72" rx="8"/><path d="M78 20H70Q65 20 61 24L37 48L61 72Q65 76 70 76H78" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>',
    "b": '<defs><mask id="upper"><rect width="96" height="96" fill="white"/><path d="M36 48V69" stroke="black" stroke-width="22"/></mask><mask id="lower"><rect width="96" height="96" fill="white"/><path d="M48 36H69" stroke="black" stroke-width="22"/></mask></defs><rect x="12" y="12" width="49" height="49" rx="15" fill="none" stroke="currentColor" stroke-width="12" mask="url(#upper)"/><rect x="35" y="35" width="49" height="49" rx="15" fill="none" stroke="currentColor" stroke-width="12" mask="url(#lower)"/>',
    "c": '<path d="M12 20Q12 12 20 12H68Q76 12 76 20Q76 28 68 28H20Q12 28 12 20ZM20 48Q20 40 28 40H76Q84 40 84 48Q84 56 76 56H28Q20 56 20 48ZM12 76Q12 68 20 68H68Q76 68 76 76Q76 84 68 84H20Q12 84 12 76Z"/><path d="M32 25L56 43M56 53L32 71" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="round"/>'
}
NAMES = {"a": "接续 K", "b": "会话相扣", "c": "工作流"}

def svg(body, width=96, height=96, color=BLUE, label="Kodo"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{label}" color="{color}" fill="currentColor">{body}</svg>\n'

def raster(source, size):
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=source.encode(),output_width=size*3,output_height=size*3))).convert("RGBA").resize((size,size),Image.Resampling.LANCZOS)

def wordmark():
    font=instantiateVariableFont(TTFont(BRAND/"fonts/Manrope-Variable.ttf"),{"wght":750},inplace=False)
    glyphs=font.getGlyphSet();cmap=font.getBestCmap();upm=font['head'].unitsPerEm
    pen=SVGPathPen(glyphs);x=0
    for char in "kodo":
        name=cmap[ord(char)];glyphs[name].draw(TransformPen(pen,(1,0,0,1,x,0)));x+=font['hmtx'][name][0]-18
    factor=82/upm
    return f'<path d="{pen.getCommands()}" transform="translate(0 79) scale({factor} -{factor})"/>',round(x*factor,3)

def build_assets():
    for name in ["logos","icons","proposals"]:(BRAND/name).mkdir(parents=True,exist_ok=True)
    for sub in ["logos","icons"]:
        for p in (BRAND/sub).iterdir():
            if p.is_file() and p.resolve().is_relative_to(BRAND.resolve()):p.unlink()
    word,width=wordmark()
    for key,mark in SYMBOLS.items():
        folder=BRAND/f"proposals/{key}";folder.mkdir(exist_ok=True)
        for suffix,color in [("",BLUE),("-ink",INK),("-white",WHITE)]:
            (folder/f"mark{suffix}.svg").write_text(svg(mark,color=color,label=f"Kodo · {NAMES[key]}"),encoding="utf-8")
            (folder/f"logo{suffix}.svg").write_text(svg(mark+f'<g transform="translate(112 0)">{word}</g>',112+width,96,color),encoding="utf-8")
        (folder/"wordmark.svg").write_text(svg(word,width,96,INK),encoding="utf-8")
        app=svg(f'<rect width="512" height="512" rx="112" fill="{BLUE}"/><g transform="translate(88 88) scale(3.5)">{mark}</g>',512,512,WHITE)
        (folder/"app.svg").write_text(app,encoding="utf-8")
        raster(svg(mark),768).save(folder/"mark.png")
        raster(app,512).save(folder/"app.png")
    for src,dest in [("mark.svg","kodo-mark.svg"),("mark-ink.svg","kodo-mark-ink.svg"),("mark-white.svg","kodo-mark-white.svg"),("logo.svg","kodo-logo.svg"),("logo-ink.svg","kodo-logo-ink.svg"),("logo-white.svg","kodo-logo-white.svg"),("wordmark.svg","kodo-wordmark.svg")]:shutil.copyfile(BRAND/"proposals/a"/src,BRAND/"logos"/dest)
    app=(BRAND/"proposals/a/app.svg").read_text(encoding="utf-8")
    (BRAND/"icons/kodo-app.svg").write_text(app,encoding="utf-8")
    for size in [16,24,32,48,64,128,180,192,256,512,1024]:raster(app,size).save(BRAND/f"icons/kodo-app-{size}.png")
    raster(app,256).save(BRAND/"icons/favicon.ico",sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    raster(app,1024).save(BRAND/"icons/kodo-app.icns")

def board():
    canvas=Image.new("RGB",(1800,1320),PAPER);d=ImageDraw.Draw(canvas)
    latin=BRAND/"fonts/Manrope-Variable.ttf";chinese=Path('C:/Windows/Fonts/msyh.ttc')
    def font(size,cjk=False):return ImageFont.truetype(str(chinese if cjk else latin),size)
    def text(x,y,t,size=20,fill=INK,cjk=False):d.text((x,y),t,font=font(size,cjk),fill=fill)
    def paste(path,x,y,w,h=None):
        if str(path).endswith('.svg'):
            data=cairosvg.svg2png(url=str(path),output_width=w*2,output_height=h*2 if h else None);im=Image.open(io.BytesIO(data)).convert('RGBA')
        else:im=Image.open(path).convert('RGBA')
        if h is None:h=round(im.height*w/im.width)
        im=im.resize((w,h),Image.Resampling.LANCZOS);canvas.paste(im,(x,y),im)
    paste(BRAND/'logos/kodo-wordmark.svg',76,52,154,76)
    text(1265,79,'LOGO EXPLORATIONS / 2026.11',18)
    d.line((76,157,1724,157),fill='#D7D8D7',width=1)
    text(76,192,'同一工作台，接续每一段工作。',35,cjk=True)
    text(77,259,'Kodo  /  Local AI session workbench',20,fill='#5C606D')
    d.rectangle((1540,205,1593,258),fill=BLUE);d.rectangle((1605,205,1658,258),fill=INK);d.rectangle((1670,205,1723,258),fill=WHITE)
    text(1483,279,'COBALT / INK / PAPER',15,fill='#5C606D')
    descriptions={'a':['以 K 为骨架，折线在同一节点接续。','字母识别直接，适合作为主标识。'],'b':['两个独立窗口相扣，保留各自边界。','强调原生会话之间的连接。'],'c':['三段轨迹沿一条折线连成整体。','强调多任务的持续推进与秩序。']}
    for i,key in enumerate(['a','b','c']):
        x=76+i*562;folder=BRAND/f'proposals/{key}'
        if i:d.line((x-24,351,x-24,1215),fill='#D7D8D7',width=1)
        text(x,350,f'{key.upper()}  /',20,fill=BLUE);text(x+60,343,NAMES[key],26,cjk=True)
        paste(folder/'mark.svg',x+142,430,230,230)
        paste(folder/'logo-ink.svg',x+104,714,300,77)
        for j,t in enumerate(descriptions[key]):text(x,849+j*35,t,20,fill='#5C606D',cjk=True)
        d.rounded_rectangle((x,974,x+506,1144),radius=18,fill=INK)
        paste(folder/'mark-white.svg',x+26,1007,104,104)
        paste(folder/'app.svg',x+201,1017,84,84)
        for j,size in enumerate([16,24,32]):
            paste(folder/'mark-white.svg',x+335+j*48,1047-size//2,size,size)
            text(x+331+j*48,1090,str(size),13,fill='#C2C5D0')
        text(x,1170,'单色反白  /  应用图标  /  小尺寸',17,fill='#5C606D',cjk=True)
    d.line((76,1243,1724,1243),fill='#D7D8D7',width=1)
    text(76,1271,'DESIGN STUDY  ·  三个方案均为可编辑矢量标识',17,fill='#5C606D',cjk=True)
    text(1306,1271,'RECOMMENDED  /  A',17,fill=BLUE)
    canvas.save(BRAND/'kodo-logo-proposals.png')
    print('Built three Kodo logo proposals and comparison board; application files untouched.')

if __name__=='__main__':
    import runpy
    runpy.run_path(str(ROOT/'scripts/build-coral-brand.py'),run_name='__main__')
