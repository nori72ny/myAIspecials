import { forwardRef, type TextareaHTMLAttributes } from "react";
type Props = Pick<TextareaHTMLAttributes<HTMLTextAreaElement>,"value"|"onChange"|"onKeyDown"|"placeholder"|"rows"|"disabled"|"className"|"aria-label"|"aria-describedby"> & { "data-testid"?: string };
/** Input-only adapter: parent state, IME guard, submit behavior, and focus ref are preserved. */
const ComposerV12=forwardRef<HTMLTextAreaElement,Props>(function ComposerV12(props,ref){return <textarea {...props} ref={ref} data-origin-composer="v12"/>;});
export default ComposerV12;
