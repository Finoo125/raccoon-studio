import { useState, useRef, useCallback } from 'react'

/** Pure helper — exported for unit tests. */
export function isAcceptedFile(file: { type: string }, accept: string): boolean {
  if (accept === 'image/*') return file.type.startsWith('image/')
  return file.type === accept
}

/**
 * Adds drag-and-drop to any container div. Returns `isDragging` for visual
 * feedback and `dragProps` to spread onto the drop-target element.
 *
 * Uses a depth counter (depthRef) so that entering/leaving child elements
 * does not cause the isDragging highlight to flicker.
 */
export function useFileDrop(
  onFile: (file: File) => void,
  accept = 'image/*',
): { isDragging: boolean; dragProps: React.HTMLAttributes<HTMLElement> } {
  const [isDragging, setIsDragging] = useState(false)
  const depthRef = useRef(0)

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    depthRef.current++
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    depthRef.current--
    if (depthRef.current === 0) setIsDragging(false)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      depthRef.current = 0
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (!file || !isAcceptedFile(file, accept)) return
      onFile(file)
    },
    [onFile, accept],
  )

  return { isDragging, dragProps: { onDragEnter, onDragLeave, onDragOver, onDrop } }
}
