import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type MenuId = "file" | "edit" | "about";

type MenuItem = {
  label: string;
  closeMenu: boolean;
  disabled?: boolean;
  suffix?: string;
  onClick: () => void;
};

type MenuBarProps = {
  onFileNew: () => void;
  onFileSaveImage: () => void;
  onEditUndo: () => void;
  onEditRedo: () => void;
  onEditToggleFill: () => void;
  fillShapes: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAboutReadme: () => void;
};

export function MenuBar(props: MenuBarProps) {
  const {
    onFileNew,
    onFileSaveImage,
    onEditUndo,
    onEditRedo,
    onEditToggleFill,
    fillShapes,
    canUndo,
    canRedo,
    onAboutReadme,
  } = props;


  function MenuTitle({ title }: { title: string }) {
    return (
      <span>
        <span style={{ textDecoration: "underline" }}>
          {title[0]}
        </span>
        {title.slice(1)}
      </span>
    );
  }

  const [open, setOpen] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const menus: { id: MenuId; title: string; items: MenuItem[] }[] = [
    {
      id: "file",
      title: "File",
      items: [
        { label: "New", closeMenu: true, onClick: onFileNew },
        { label: "Save as Image", closeMenu: true, onClick: onFileSaveImage },
      ],
    },
    {
      id: "edit",
      title: "Edit",
      items: [
        { label: "Undo", closeMenu: true, disabled: !canUndo, onClick: onEditUndo },
        { label: "Redo", closeMenu: true, disabled: !canRedo, onClick: onEditRedo },
        {
          label: "Fill Shapes",
          closeMenu: false,
          suffix: fillShapes ? "✓ " : "",
          onClick: onEditToggleFill,
        },
      ],
    },
    {
      id: "about",
      title: "About",
      items: [{ label: "Readme", closeMenu: true, onClick: onAboutReadme }],
    },
  ];

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!barRef.current?.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function toggle(menu: MenuId) {
    setOpen((prev) => (prev === menu ? null : menu));
  }

  function runItem(closeAfter: boolean, action: () => void) {
    action();
    if (closeAfter) {
      setOpen(null);
    }
  }

  function labelKeyDown(menu: MenuId, e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(menu);
    }
  }

  return (
    <nav className="board-menu-bar" ref={barRef} aria-label="Application menu">
      {menus.map((menu) => (
        <div key={menu.id} className="board-menu-item-wrap">
          <span
            className="board-menu-label"
            tabIndex={0}
            role="button"
            aria-expanded={open === menu.id}
            aria-haspopup="true"
            onClick={() => toggle(menu.id)}
            onKeyDown={(e) => labelKeyDown(menu.id, e)}
          >
            <MenuTitle title={menu.title} />
          </span>
          {open === menu.id ? (
            <ul className="win-menu-dropdown board-menu-dropdown-panel" role="menu">
              {menu.items.map((item) => (
                <li key={item.label} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => runItem(item.closeMenu, item.onClick)}
                  >
                    {item.label} {item.suffix}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <div className="board-menu-title">
        Mini Raft Paint 98
      </div>
    </nav>
  );
}
