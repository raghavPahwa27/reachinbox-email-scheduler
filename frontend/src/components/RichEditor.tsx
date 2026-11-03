import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  IndentIncrease,
  IndentDecrease,
} from "lucide-react";
export function RichEditor({
  onChange,
}: {
  onChange: (text: string, html: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Type Your Reply..." }),
    ],
    editorProps: {
      attributes: {
        "aria-label": "Email message",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getText(), editor.getHTML()),
  });
  useEditorState({ editor, selector: ({ editor }) => editor?.state });
  if (!editor) return null;
  const controls = [
    {
      label: "Undo",
      icon: Undo2,
      run: () => editor.chain().focus().undo().run(),
      disabled: !editor.can().undo(),
    },
    {
      label: "Redo",
      icon: Redo2,
      run: () => editor.chain().focus().redo().run(),
      disabled: !editor.can().redo(),
    },
    {
      label: "Bold",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline",
      icon: Underline,
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Align left",
      icon: AlignLeft,
      active: editor.isActive({ textAlign: "left" }),
      run: () => editor.chain().focus().setTextAlign("left").run(),
    },
    {
      label: "Align center",
      icon: AlignCenter,
      active: editor.isActive({ textAlign: "center" }),
      run: () => editor.chain().focus().setTextAlign("center").run(),
    },
    {
      label: "Align right",
      icon: AlignRight,
      active: editor.isActive({ textAlign: "right" }),
      run: () => editor.chain().focus().setTextAlign("right").run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Bullet list",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Indent list",
      icon: IndentIncrease,
      disabled: !editor.can().sinkListItem("listItem"),
      run: () => editor.chain().focus().sinkListItem("listItem").run(),
    },
    {
      label: "Outdent list",
      icon: IndentDecrease,
      disabled: !editor.can().liftListItem("listItem"),
      run: () => editor.chain().focus().liftListItem("listItem").run(),
    },
    {
      label: "Quote",
      icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Strikethrough",
      icon: Strikethrough,
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
  ];
  return (
    <div className="rich-editor">
      <div
        className="format-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        {controls.slice(0, 2).map((c) => (
          <button
            type="button"
            key={c.label}
            title={c.label}
            aria-label={c.label}
            disabled={c.disabled}
            onClick={c.run}
          >
            <c.icon size={17} />
          </button>
        ))}
        <select
          aria-label="Text style"
          value={
            editor.isActive("heading", { level: 2 }) ? "heading" : "paragraph"
          }
          onChange={(e) =>
            e.target.value === "heading"
              ? editor.chain().focus().setHeading({ level: 2 }).run()
              : editor.chain().focus().setParagraph().run()
          }
        >
          <option value="paragraph">Tt</option>
          <option value="heading">Heading</option>
        </select>
        {controls.slice(2).map((c) => (
          <button
            type="button"
            key={c.label}
            title={c.label}
            aria-label={c.label}
            aria-pressed={c.active}
            disabled={c.disabled}
            onClick={c.run}
          >
            <c.icon size={17} />
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
