'use client'

import { useState, useRef, useEffect, useLayoutEffect, useId, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'

interface InlineEditProps {
  value: string
  onSave: (value: string) => void | Promise<void>
  // Observe buffered keystrokes without committing them; Escape still cancels.
  onDraftChange?: (value: string) => void
  className?: string
  inputClassName?: string
  placeholder?: string
  multiline?: boolean
  emptyText?: string
  id?: string
  name?: string
  autocomplete?: string
}

export function InlineEdit({
  value,
  onSave,
  onDraftChange,
  className,
  inputClassName,
  placeholder,
  multiline = false,
  emptyText,
  id: providedId,
  name,
  autocomplete = 'off'
}: InlineEditProps) {
  const generatedId = useId()
  const id = providedId || generatedId
  const { t } = useTranslation()
  const defaultEmptyText = emptyText || t('common.clickToEdit')
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // React state is not a same-event-batch lock (Enter may be followed by blur).
  const editingRef = useRef(false)
  const savingRef = useRef(false)
  const restoreFocusRef = useRef(false)
  const mountedRef = useRef(false)
  const committedValueRef = useRef(value)

  // An older request may reject after a newer parent value has committed.
  // Track committed props, not speculative render values or the save closure.
  useLayoutEffect(() => { committedValueRef.current = value }, [value])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!isSaving && restoreFocusRef.current) {
      restoreFocusRef.current = false
      const active = document.activeElement
      // A late acknowledgement must not pull focus back from another control.
      if (active !== document.body && active !== inputRef.current && active !== buttonRef.current) return
      if (isEditing) inputRef.current?.focus()
      else buttonRef.current?.focus()
    }
  }, [isEditing, isSaving])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(value)
  }, [value])

  const handleSave = async () => {
    if (!editingRef.current || savingRef.current) return
    if (editValue.trim() === value.trim()) {
      editingRef.current = false
      setIsEditing(false)
      return
    }

    savingRef.current = true
    setIsSaving(true)
    try {
      await onSave(editValue.trim())
      if (!mountedRef.current) return
      editingRef.current = false
      setIsEditing(false)
    } catch {
      // Preserve the existing rollback contract; the caller owns error toasts.
      if (mountedRef.current) setEditValue(committedValueRef.current)
    } finally {
      savingRef.current = false
      if (mountedRef.current) setIsSaving(false)
    }
  }

  const handleCancel = () => {
    if (savingRef.current) return
    editingRef.current = false
    restoreFocusRef.current = true
    setEditValue(value)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      restoreFocusRef.current = true
      void handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  if (!isEditing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2 -my-1 transition-colors text-left w-full break-all",
          className
        )}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          editingRef.current = true
          setIsEditing(true)
        }}
      >
        {value || <span className="text-muted-foreground">{defaultEmptyText}</span>}
      </button>
    )
  }

  if (multiline) {
    return (
      <textarea
        ref={inputRef as RefObject<HTMLTextAreaElement>}
        value={editValue}
        onChange={(e) => { setEditValue(e.target.value); onDraftChange?.(e.target.value) }}
        onKeyDown={handleKeyDown}
        onBlur={() => { void handleSave() }}
        className={cn(
          "px-2 py-1 bg-background border rounded focus:outline-none focus:ring-2 focus:ring-primary w-full",
          "min-h-[60px] resize-none",
          inputClassName
        )}
        placeholder={placeholder}
        disabled={isSaving}
        id={id}
        name={name}
        autoComplete={autocomplete}
      />
    )
  }

  return (
    <input
      ref={inputRef as RefObject<HTMLInputElement>}
      value={editValue}
      onChange={(e) => { setEditValue(e.target.value); onDraftChange?.(e.target.value) }}
      onKeyDown={handleKeyDown}
      onBlur={() => { void handleSave() }}
      className={cn(
        "px-2 py-1 bg-background border rounded focus:outline-none focus:ring-2 focus:ring-primary w-full",
        inputClassName
      )}
      placeholder={placeholder}
      disabled={isSaving}
      id={id}
      name={name}
      autoComplete={autocomplete}
    />
  )
}
