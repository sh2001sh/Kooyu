"""Create an image overview and two focused design handoff ZIP archives."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from zipfile import ZipFile,ZIP_DEFLATED
import json,shutil

ROOT=Path(__file__).resolve().parents[1]
BRAND=ROOT/'brand'
DESIGNS=BRAND/'product-design'
ITEMS=[('01-positioning','产品定位与视觉方向'),('02-website','官网首页'),('03-desktop-light','桌面工作台 · 浅色'),('04-desktop-dark','桌面工作台 · 深色'),('06-brand-applications','品牌应用'),('05-mobile','手机端')]

def main():
    canvas=Image.new('RGB',(2400,2640),'#FAF8F4');d=ImageDraw.Draw(canvas)
    face='C:/Windows/Fonts/msyh.ttc'
    d.text((64,43),'Kooyu · 历史产品设计参考',font=ImageFont.truetype(face,43),fill='#28232A')
    d.text((65,111),'原 Kodo 概念图 / 最新 Kooyu 标识另见正式素材包',font=ImageFont.truetype(face,24),fill='#726B72')
    for index,(name,label) in enumerate(ITEMS):
        source=DESIGNS/f'{name}.png'
        with Image.open(source) as im:
            im.load();image=im.convert('RGB');assert im.info.get('kodo:model')=='gpt-image-2'
            expected=(1024,1536) if name=='05-mobile' else (1536,1024)
            assert im.size==expected,(name,im.size)
        image.thumbnail((1112,741),Image.Resampling.LANCZOS)
        x=64+(index%2)*1160;y=180+(index//2)*800
        canvas.paste(image,(x+(1112-image.width)//2,y+(741-image.height)//2))
        d.text((x,y+754),label,font=ImageFont.truetype(face,25),fill='#28232A')
    d.text((64,2590),'设计概念 · 示例内容 / 品牌素材另附真正的 SVG 路径与应用图标',font=ImageFont.truetype(face,22),fill='#726B72')
    canvas.save(DESIGNS/'overview.png')
    bundles=[]
    for folder,destination,prefix in [(BRAND/'assets',BRAND/'kooyu-brand-assets.zip','kooyu-brand-assets'),(DESIGNS,BRAND/'kooyu-product-designs.zip','kooyu-product-designs')]:
        with ZipFile(destination,'w',ZIP_DEFLATED,compresslevel=6) as archive:
            for file in sorted(folder.rglob('*')):
                if file.is_file():
                    assert file.suffix not in ['.log','.env','.key']
                    archive.write(file,Path(prefix)/file.relative_to(folder))
        with ZipFile(destination) as archive:
            assert archive.testzip() is None
            bundles.append({'path':str(destination.relative_to(ROOT)),'files':len(archive.namelist()),'bytes':destination.stat().st_size})
    shutil.copyfile(BRAND/'kooyu-brand-assets.zip',BRAND/'kodo-brand-assets.zip')
    shutil.copyfile(BRAND/'kooyu-product-designs.zip',BRAND/'kodo-product-designs.zip')
    (BRAND/'handoff.json').write_text(json.dumps({'brand':'Kooyu','confirmed_on':'2026-11-13','concept_images':'Historical Kodo layout concepts; current Kooyu logo lives in assets.','direction':'灵动回环 A · 日落珊瑚','design_images':len(ITEMS),'asset_index':'assets/README.md','design_index':'product-design/README.md','bundles':bundles},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(bundles,ensure_ascii=False))

if __name__=='__main__':main()
