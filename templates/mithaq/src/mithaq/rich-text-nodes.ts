// The Lexical node classes this project's rich text is written in: the one
// list both halves read, the server's write and every screen's editor and
// viewer, so neither can take a node the other does not. A node of the
// project's own is spread after the defaults, `[...defaultNodes, CalloutNode]`,
// and a node that draws React keeps its DOM-free class here and its React
// subclass in the client file.
import { defaultNodes } from 'mithaq/rich-text'
// add-on: uploads
import { UploadNode } from 'mithaq/rich-text'
// end add-on: uploads

export const richTextNodes = [
  ...defaultNodes,
  // add-on: uploads
  // An image of the organization's own files inside the text, whose server half
  // refuses one pointing at a kayan that holds no files.
  UploadNode,
  // end add-on: uploads
]
