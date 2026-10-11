import type { ReactNode } from "react";
/** Semantic header wrapper; all existing controls and state remain caller-owned. */
export default function HeaderV12({children,className}:{children:ReactNode;className?:string}) {
  return <header className={className} data-origin-header="v12">{children}</header>;
}
