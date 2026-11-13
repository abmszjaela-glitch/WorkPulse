import { useEffect, useRef } from 'react'

export default function Modal({ titleId, descriptionId, onClose, className = '', children }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
  }, [])
  return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={descriptionId} className={className} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
    if (event.target !== ref.current) return
    const bounds = ref.current.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
  }}>{children}</dialog>
}
