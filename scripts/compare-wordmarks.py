"""Make three true-vector wordmark pairings with the unchanged approved symbol."""
from pathlib import Path
import io,json,re
from PIL import Image,ImageDraw,ImageFont
import cairosvg
from brand_wordmark import OPTIONS,outlines

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'brand/wordmark-studies'

def main():
    OUT.mkdir(exist_ok=True)
    mark=(ROOT/'brand/assets/svg/kodo-mark.svg').read_text(encoding='utf-8')
    defs=re.search(r'<defs>.*?</defs>',mark,re.S).group()
    art=mark[mark.index('</defs>')+7:mark.rindex('</svg>')].strip()
    canvas=Image.new('RGB',(1800,1480),'#FAF8F4');d=ImageDraw.Draw(canvas)
    face='C:/Windows/Fonts/msyh.ttc'
    d.text((76,48),'Kodo · 字标与图形的协调',font=ImageFont.truetype(face,37),fill='#28232A')
    d.text((76,109),'柔和的曲线、更轻的字重，以及恰好的字距',font=ImageFont.truetype(face,23),fill='#726B72')
    metadata=[]
    for i,(key,item) in enumerate(OPTIONS.items()):
        word,scale,width,meta=outlines(key);metadata.append(meta)
        folder=OUT/key;folder.mkdir(exist_ok=True)
        total=round(181+width+16,2)
        for suffix,color in [('', '#28232A'),('-dark','#FAF8F4')]:
            source=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} 132" width="{total}" height="132" role="img" aria-label="Kodo">{defs}<g transform="translate(-18 -24) scale(.1875)">{art}</g><path d="{word}" fill="{color}" transform="translate(181 108) scale({scale} -{scale})"/></svg>'
            (folder/f'logo{suffix}.svg').write_text(source,encoding='utf-8')
        source=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width+8} 132" width="{width+8}" height="132"><path d="{word}" fill="#28232A" transform="translate(4 108) scale({scale} -{scale})"/></svg>'
        (folder/'wordmark.svg').write_text(source,encoding='utf-8')
        row=205+i*415
        d.line((76,row-10,1724,row-10),fill='#E5DEDA',width=1)
        d.text((76,row+18),f"{'ABC'[i]}  {item['name']}",font=ImageFont.truetype(face,27),fill='#28232A')
        d.text((76,row+69),item['description'],font=ImageFont.truetype(face,21),fill='#726B72')
        for suffix,target_w,x,y in [('',760,76,row+128),('-dark',510,1135,row+138)]:
            data=cairosvg.svg2png(url=str(folder/f'logo{suffix}.svg'),output_width=target_w*2)
            image=Image.open(io.BytesIO(data)).convert('RGBA');image=image.resize((target_w,round(image.height/2)),Image.Resampling.LANCZOS)
            if suffix:d.rounded_rectangle((1090,row+110,1724,row+335),radius=18,fill='#28232A')
            canvas.paste(image,(x,y),image)
            if not suffix:image.save(folder/'logo.png')
        d.text((77,row+377),f"{item['family']} · {item['weight']} / 字标已转为矢量路径",font=ImageFont.truetype(face,17),fill='#726B72')
    canvas.save(OUT/'comparison.png')
    (OUT/'options.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Generated three vector wordmark pairings and comparison board.')

if __name__=='__main__':main()
