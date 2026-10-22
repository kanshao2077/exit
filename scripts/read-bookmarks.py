"""Parse a Netscape bookmark export locally; discard icons and unrelated attributes."""
from html.parser import HTMLParser
from pathlib import Path
import json, sys
class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root={'id':'0','title':'','children':[]}; self.stack=[self.root]; self.pending=None; self.capture=None; self.attrs={}; self.counter=0
    def handle_starttag(self,tag,attrs):
        if tag in ('h3','a'):
            self.capture=tag; self.attrs=dict(attrs); self.text=''
        elif tag=='dl' and self.pending:
            self.stack.append(self.pending); self.pending=None
    def handle_data(self,data):
        if self.capture: self.text+=data
    def handle_endtag(self,tag):
        if tag==self.capture:
            self.counter+=1
            n={'id':f'snapshot-{self.counter}','parentId':self.stack[-1]['id'],'title':self.text.strip(),'index':len(self.stack[-1]['children'])}
            if tag=='a': n['url']=self.attrs.get('href','')
            else:
                n['children']=[]
                if self.attrs.get('personal_toolbar_folder')=='true': n['folderType']='bookmarks-bar'
                self.pending=n
            self.stack[-1]['children'].append(n); self.capture=None
        elif tag=='dl' and len(self.stack)>1: self.stack.pop()
p=Parser(); p.feed(Path(sys.argv[1]).read_text())
# HTML exports can have loose bookmarks outside the toolbar. Give them a real root container.
loose=[n for n in p.root['children'] if 'url' in n]
if loose:
    other={'id':'snapshot-other','parentId':'0','title':'其他书签','folderType':'other','children':loose}
    for n in loose: n['parentId']=other['id']
    p.root['children']=[n for n in p.root['children'] if 'url' not in n]+[other]
Path(sys.argv[2]).write_text(json.dumps([p.root],ensure_ascii=False,indent=2))
def walk(n,path):
    if 'url' in n:
        print(json.dumps({'id':n['id'],'title':n['title'],'url':n['url'],'path':path},ensure_ascii=False))
    else:
        for c in n.get('children',[]): walk(c,path+([n['title']] if n['title'] else []))
walk(p.root,[])
