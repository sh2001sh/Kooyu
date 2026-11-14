"""Color studies of the accepted AI-generated Kodo mark; preserve its geometry."""
from pathlib import Path
import hashlib
import io
import json
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'brand/mobius-k/lilt.png'
OUT = ROOT / 'brand/mobius-k/colors'
PALETTES = [
    {'id':'iris','name':'鸢尾蓝紫','note':'清爽、灵动；科技感与亲和力更平衡',
     'shadow':'#34228F','main':'#6959E8','highlight':'#BAC2FF','nearwhite':'#EEEDFF'},
    {'id':'coral','name':'日落珊瑚','note':'温暖、活泼；更有独立产品的个性',
     'shadow':'#A03259','main':'#F17561','highlight':'#FFD0B3','nearwhite':'#FFF1E9'},
    {'id':'berry','name':'莓果紫','note':'鲜明、有表现力；更偏创意工具气质',
     'shadow':'#63247B','main':'#BD4AA3','highlight':'#EFB9DD','nearwhite':'#FCEFFA'},
    {'id':'graphite','name':'石墨银','note':'克制、精致；轮廓感强，活泼感较弱',
     'shadow':'#282D43','main':'#647088','highlight':'#C6CCD9','nearwhite':'#EFF0F5'}
]

def hexrgb(color):
    return np.array([int(color[i:i+2],16) for i in (1,3,5)],dtype=np.float64)/255

def to_oklab(rgb):
    linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
    lms=linear@np.array([[.4122214708,.5363325363,.0514459929],
                         [.2119034982,.6806995451,.1073969566],
                         [.0883024619,.2817188376,.6299787005]]).T
    return np.cbrt(lms)@np.array([[.2104542553,.7936177850,-.0040720468],
                                 [1.9779984951,-2.4285922050,.4505937099],
                                 [.0259040371,.7827717662,-.8086757660]]).T

def from_oklab(lab):
    lms=(lab@np.array([[1,.3963377774,.2158037573],
                       [1,-.1055613458,-.0638541728],
                       [1,-.0894841775,-1.2914855480]]).T)**3
    linear=lms@np.array([[4.0767416621,-3.3077115913,.2309699292],
                         [-1.2684380046,2.6097574011,-.3413193965],
                         [-.0041960863,-.7034186147,1.7076147010]]).T
    return np.clip(np.where(linear<=.0031308,linear*12.92,1.055*np.maximum(linear,0)**(1/2.4)-.055),0,1)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    digest=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    original=np.array(Image.open(SOURCE).convert('RGB'),dtype=np.float64)/255
    lab=to_oklab(original)
    saturation=original.max(axis=-1)-original.min(axis=-1)
    alpha=np.clip((saturation-.018)/.075,0,1)
    alpha=alpha*alpha*(3-2*alpha)
    mask=Image.fromarray(np.uint8(alpha*255))
    mask.save(OUT/'source-color-mask.png')
    for palette in PALETTES:
        anchors=to_oklab(np.stack([hexrgb(palette[k]) for k in ['shadow','main','highlight','nearwhite']]))
        mapped=np.stack([np.interp(lab[...,0],[.25,.50,.80,.96],anchors[:,i]) for i in range(3)],axis=-1)
        colored=from_oklab(mapped)
        result=original*(1-alpha[...,None])+colored*alpha[...,None]
        data=np.uint8(np.round(np.clip(result,0,1)*255))
        assert np.array_equal(data[alpha==0],np.uint8(np.round(original[alpha==0]*255)))
        Image.fromarray(data).save(OUT/f"{palette['id']}.png")
    (OUT/'palettes.json').write_text(json.dumps({'source':'../lilt.png','source_sha256':digest,'method':'Oklab gradient mapping of source shading; original shape and background preserved','palettes':PALETTES},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==digest
    board(mask)
    for palette in PALETTES:
        with Image.open(OUT/f"{palette['id']}.png") as im:
            assert im.size==(1024,1024);im.verify()
    print('Saved four color studies and comparison; verified original SHA-256, background preservation and image dimensions.')

def board(mask):
    canvas=Image.new('RGB',(2000,1800),'#FAF9F6');d=ImageDraw.Draw(canvas)
    font_path='C:/Windows/Fonts/msyh.ttc'
    def font(size):return ImageFont.truetype(font_path,size)
    d.text((90,55),'Kodo · A 标识配色',font=font(37),fill='#252A38')
    d.text((90,121),'灵动回环 / 同一造型，四种色彩气质',font=font(23),fill='#666674')
    d.line((90,180,1910,180),fill='#DADAE1',width=1)
    bbox=mask.getbbox();assert bbox
    x1,y1,x2,y2=bbox;pad=24
    bbox=(max(0,x1-pad),max(0,y1-pad),min(1024,x2+pad),min(1024,y2+pad))
    for index,palette in enumerate(PALETTES):
        x=(index%2)*1000;y=215+(index//2)*770
        image=Image.open(OUT/f"{palette['id']}.png").convert('RGB').crop(bbox)
        image.thumbnail((790,565),Image.Resampling.LANCZOS)
        canvas.paste(image,(x+(1000-image.width)//2,y+(570-image.height)//2))
        d.text((x+90,y+593),f"{'ABCD'[index]}  {palette['name']}",font=font(28),fill='#252A38')
        d.text((x+90,y+642),palette['note'],font=font(21),fill='#606371')
        for j,key in enumerate(['shadow','main','highlight']):
            swatch_x=x+90+j*245
            d.rounded_rectangle((swatch_x,y+692,swatch_x+37,y+729),radius=9,fill=palette[key])
            d.text((swatch_x+49,y+697),palette[key].upper(),font=font(18),fill='#606371')
    d.line((90,977,1910,977),fill='#DADAE1',width=1)
    d.line((1000,235,1000,1730),fill='#DADAE1',width=1)
    canvas.save(OUT/'comparison.png')

if __name__=='__main__':main()
