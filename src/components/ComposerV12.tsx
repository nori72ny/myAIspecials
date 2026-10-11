import { forwardRef, type TextareaHTMLAttributes } from "react";
type Props = Pick<TextareaHTMLAttributes<HTMLTextAreaElement>,"value"|"onChange"|"onKeyDown"|"placeholder"|"rows"|"disabled"|"className"|"aria-label"|"aria-describedby"|"style"> & { "data-testid"?: string };
/** Input-only adapter: parent state, IME guard, submit behavior, and focus ref are preserved. */
const ComposerV12=forwardRef<HTMLTextAreaElement,Props>(function ComposerV12({className="",...props},ref){
 return <>
  <textarea
   {...props}
   ref={ref}
   data-origin-composer="v12"
   className={["focus:outline-none","focus:ring-0","focus:border-transparent","focus-visible:outline-none","focus-visible:ring-0","outline-none",className].filter(Boolean).join(" ")}
   style={{outline:"none",boxShadow:"none",...props.style}}
  />
  <style>{`
   textarea[data-origin-composer="v12"],
   textarea[data-origin-composer="v12"]:focus,
   textarea[data-origin-composer="v12"]:focus-visible {
     outline: none !important;
     box-shadow: none !important;
     --tw-ring-offset-shadow: 0 0 #0000 !important;
     --tw-ring-shadow: 0 0 #0000 !important;
     border-color: transparent !important;
   }
  `}</style>
 </>;
});
export default ComposerV12;
