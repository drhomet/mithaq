// The Lexical node classes this project's rich text is written in: the one
// list both halves read, the server's write and every screen's editor and
// viewer, so neither can take a node the other does not. A node of the
// project's own is spread after the defaults, `[...defaultNodes, CalloutNode]`,
// and a node that draws React keeps its DOM-free class here and its React
// subclass in the client file. This project opts in to the upload node, an
// image of the organization's own `media` inside the text, whose server half
// refuses one pointing at a kayan that holds no files.
import { defaultNodes, UploadNode } from 'mithaq/rich-text'

export const richTextNodes = [...defaultNodes, UploadNode]
