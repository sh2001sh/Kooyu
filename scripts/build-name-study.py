"""Create a standalone naming lockup without changing the production identity."""
from pathlib import Path
import argparse,io,re
from xml.etree import ElementTree as ET
import cairosvg
from PIL import Image,ImageDraw,ImageFont
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

ROOT=Path(__file__).resolve().parents[1]
INK,PAPER='#28232A','#FAF8F4'

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--name',required=True)
    args=parser.parse_args()
    assert re.fullmatch(r'[A-Za-z]{3,12}',args.name),'Use a short alphabetic name.'
    name=args.name;slug=name.lower()
    out=ROOT/'brand/naming-studies'/slug;out.mkdir(parents=True,exist_ok=True)
    original=(ROOT/'brand/assets/svg/kodo-mark.svg').read_bytes()
    mark=original.decode('utf-8');defs=re.search(r'<defs>.*?</defs>',mark,re.S).group()
    art=mark[mark.index('</defs>')+7:mark.rindex('</svg>')].strip()
    font=instantiateVariableFont(TTFont(ROOT/'brand/fonts/Quicksand/Quicksand-Variable.ttf'),{'wght':590},inplace=False)
    glyphs=font.getGlyphSet();cmap=font.getBestCmap();upm=font['head'].unitsPerEm
    pen=SVGPathPen(glyphs);bounds=BoundsPen(glyphs);x=0
    tracking=[-.025,-.012,-.008,-.010] if slug=='kooyu' else ([-.025,-.012,-.018,-.003] if slug=='koomi' else [-.015]*(len(slug)-1))
    for index,char in enumerate(slug):
        glyph=cmap[ord(char)];transform=(1,0,.065,1,x,0)
        glyphs[glyph].draw(TransformPen(pen,transform));glyphs[glyph].draw(TransformPen(bounds,transform))
        x+=font['hmtx'][glyph][0]
        if index<len(tracking):x+=tracking[index]*upm
    x0,y0,x1,y1=bounds.bounds;scale=88/(y1-y0);width=(x1-x0)*scale;path=pen.getCommands()
    sources={}
    for suffix,color in [('',INK),('-dark',PAPER)]:
        source=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {181+width+16} 132" role="img" aria-label="{name}">{defs}<g transform="translate(-18 -24) scale(.1875)">{art}</g><path d="{path}" fill="{color}" transform="translate({181-x0*scale} {20+y1*scale}) scale({scale} -{scale})"/></svg>'
        sources[suffix]=source
        (out/f'{slug}-logo{suffix}.svg').write_text(source,encoding='utf-8')
        cairosvg.svg2png(bytestring=source.encode(),write_to=str(out/f'{slug}-logo{suffix}.png'),output_width=2200)
    source=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width+8} 132" role="img" aria-label="{name}"><path d="{path}" fill="{INK}" transform="translate({4-x0*scale} {20+y1*scale}) scale({scale} -{scale})"/></svg>'
    (out/f'{slug}-wordmark.svg').write_text(source,encoding='utf-8')
    (out/f'{slug}-mark.svg').write_bytes(original)
    canvas=Image.new('RGB',(1800,1270),PAPER);draw=ImageDraw.Draw(canvas)
    font=lambda n:ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',n)
    draw.text((80,48),f'{name} · 正式品牌标识' if slug=='kooyu' else f'{name} · 字标组合提案',font=font(38),fill=INK)
    if slug in ['koomi','kooyu']:
        draw.text((80,110),('KOO–yoo / 五个字母 · 两个音节 · 圆润的双 o' if slug=='kooyu' else 'koo–mee / 五个字母 · 两个音节 · 圆润的双 o'),font=font(24),fill='#726B72')
    draw.line((80,177,1720,177),fill='#E5DEDA',width=2)
    for suffix,target,x,y in [('',1250,270,226),('-dark',980,410,775)]:
        if suffix:draw.rounded_rectangle((80,730,1720,1048),radius=24,fill=INK)
        image=Image.open(io.BytesIO(cairosvg.svg2png(bytestring=sources[suffix].encode(),output_width=target))).convert('RGBA')
        canvas.paste(image,(x,y),image)
    draw.text((80,585),'让工作，接着向前。',font=font(34),fill=INK)
    draw.text((80,640),'沿用莫比乌斯丝带与日落珊瑚配色',font=font(24),fill='#726B72')
    draw.text((80,1100),'矢量路径 SVG · 透明 PNG · 应用图标 · React 组件' if slug=='kooyu' else '仅为视觉提案 · 名称、域名与商标需独立核查',font=font(24),fill='#726B72')
    if slug=='koomi':
        draw.text((80,1145),'已发现 koomi.ai 使用同名 Koomi AI，涉及编码代理相关服务',font=font(23),fill='#A03259')
    draw.text((80,1200),'品牌正式确认 / 2026-11-13' if slug=='kooyu' else '提案 / 2026-11-13',font=font(20),fill='#726B72')
    canvas.save(out/'preview.png')
    for file in out.glob('*.svg'):
        tags={node.tag.rsplit('}',1)[-1] for node in ET.parse(file).iter()}
        assert not tags.intersection({'image','text'}),file
    assert (out/f'{slug}-mark.svg').read_bytes()==original
    for file in out.glob(f'{slug}-logo*.png'):
        with Image.open(file) as image:image.load();assert image.mode=='RGBA' and image.getextrema()[3][0]==0
    print(f'Generated and checked {name} proposal at {out}; original mark preserved.')

if __name__=='__main__':main()
