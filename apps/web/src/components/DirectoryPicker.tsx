import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Folder, HardDrive, Home } from "lucide-react";
import { api } from "../lib/host-client";
import { Modal } from "./Motion";

interface DirectoryListing {
  path: string;
  home: string;
  parent: string | null;
  roots: string[];
  directories: { name: string; path: string }[];
}

export function DirectoryPicker({
  initialPath,
  onClose,
  onSelect,
}: {
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const open = (path?: string) => {
    const current = ++requestId.current;
    setLoading(true);
    setError("");
    void api<DirectoryListing>(`/directories${path ? `?path=${encodeURIComponent(path)}` : ""}`)
      .then((next) => {
        if (current === requestId.current) setListing(next);
      })
      .catch((cause: Error) => {
        if (current === requestId.current) setError(cause.message);
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });
  };

  useEffect(() => {
    open(initialPath);
    return () => {
      requestId.current += 1;
    };
  }, []);

  return (
    <Modal title="选择工作目录" onClose={onClose}>
      <div className="directory-picker">
        <div className="directory-picker__toolbar">
          <button
            type="button"
            aria-label="上级目录"
            title="上级目录"
            disabled={!listing?.parent}
            onClick={() => open(listing?.parent ?? undefined)}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="主目录"
            title="主目录"
            disabled={!listing}
            onClick={() => open(listing?.home)}
          >
            <Home size={16} />
          </button>
          {listing?.roots.map((root) => (
            <button
              type="button"
              key={root}
              className="directory-picker__root"
              onClick={() => open(root)}
            >
              <HardDrive size={14} /> {root}
            </button>
          ))}
        </div>
        <div className="directory-picker__path" title={listing?.path}>
          {listing?.path ?? "正在读取目录…"}
        </div>
        {error && (
          <p className="directory-picker__error" role="alert">
            {error}
          </p>
        )}
        <ul className="directory-picker__list" aria-label="子目录">
          {listing?.directories.map((directory) => (
            <li key={directory.path}>
              <button type="button" onClick={() => open(directory.path)}>
                <Folder size={16} aria-hidden="true" />
                <span>{directory.name}</span>
              </button>
            </li>
          ))}
          {!loading && !error && listing?.directories.length === 0 && (
            <li className="directory-picker__empty">没有子目录</li>
          )}
        </ul>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!listing || loading || !!error}
            onClick={() => listing && onSelect(listing.path)}
          >
            选择此目录
          </button>
        </div>
      </div>
    </Modal>
  );
}
