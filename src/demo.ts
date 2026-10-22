import type { Node } from './model';
export const demoTree: Node[] = [{ id: '0', title: '', children: [
  { id: '1', parentId: '0', title: '书签栏', folderType: 'bookmarks-bar', children: [
    { id: '10', parentId: '1', title: '视频创作', children: [
      { id: '11', parentId: '10', title: 'Runway', url: 'https://runwayml.com/' },
      { id: '12', parentId: '10', title: 'DaVinci Resolve', url: 'https://www.blackmagicdesign.com/products/davinciresolve' },
      { id: '13', parentId: '10', title: '影像参考', children: [{ id: '14', parentId: '13', title: 'Vimeo', url: 'https://vimeo.com/' }] },
    ] },
    { id: '20', parentId: '1', title: '视觉设计', children: [
      { id: '21', parentId: '20', title: 'Are.na', url: 'https://www.are.na/' },
      { id: '22', parentId: '20', title: 'Figma', url: 'https://www.figma.com/' },
    ] },
    { id: '30', parentId: '1', title: '开发编程', children: [{ id: '31', parentId: '30', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' }] },
    { id: '40', parentId: '1', title: '阅读与写作', children: [{ id: '41', parentId: '40', title: 'verso.', url: 'https://kanshao2077.github.io/jianbai/' }] },
  ] },
  { id: '2', parentId: '0', title: '其他书签', folderType: 'other', children: [] },
] }];
