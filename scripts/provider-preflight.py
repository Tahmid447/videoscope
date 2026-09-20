import asyncio,json
from media_api.extraction import events

async def main():
    rows=[]
    async for event in events('https://www.youtube.com/@FilmiIndian/videos','collection',limit=3,timeout=120):
        if event.get('event')=='item':
            rows.append(event['item'])
    assert len(rows)==3, rows
    assert all(x['thumbnail_url'] and x['title'] and isinstance(x['views'],(int,float)) for x in rows)
    assert all(x['date_precision']=='approximate' for x in rows)
    print('GUARDED_YOUTUBE_EXTRACTION',json.dumps({'records':len(rows),'dates':'approximate','views_present':True,'thumbnails_present':True}))
asyncio.run(main())
