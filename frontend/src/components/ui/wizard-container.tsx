"use client"

import { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface WizardStep {
  number: number
  title: string
  description: string
}

interface WizardContainerProps {
  children: ReactNode
  currentStep: number
  steps: readonly WizardStep[]
  onStepClick?: (step: number) => void
  className?: string
}

function StepIndicator({ currentStep, steps, onStepClick }: {
  currentStep: number
  steps: readonly WizardStep[]
  onStepClick?: (step: number) => void
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted">
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.number
        const isCurrent = currentStep === step.number
        const isClickable = step.number <= currentStep && onStepClick
        
        return (
          <div key={step.number} className="flex items-center flex-1">
            <button
              type="button"
              disabled={!isClickable}
              aria-current={isCurrent ? "step" : undefined}
              className={cn('flex items-center text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', isClickable && 'cursor-pointer')}
              onClick={isClickable ? () => onStepClick(step.number) : undefined}
            >
              <span
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-medium transition-colors',
                  isCompleted 
                    ? 'bg-primary border-primary text-primary-foreground' 
                    : isCurrent 
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground bg-card'
                )}
              >
                {isCompleted ? "✓" : step.number}
              </span>
              <span className="ml-3 min-w-0">
                <span className={cn(
                  'block text-sm font-medium',
                  isCurrent ? 'text-foreground' : 'text-muted-foreground'
                )}>
                  {step.title}
                </span>
                <span className={cn(
                  'block text-xs',
                  isCurrent ? 'text-muted-foreground' : 'text-muted-foreground/80'
                )}>
                  {step.description}
                </span>
              </span>
            </button>
            {index < steps.length - 1 && (
              <div 
                className={cn(
                  'flex-1 border-t-2 mx-4 transition-colors',
                  isCompleted ? 'border-primary' : 'border-border/60'
                )} 
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function WizardContainer({
  children,
  currentStep,
  steps,
  onStepClick,
  className
}: WizardContainerProps) {
  return (
    <div className={cn('flex flex-col h-[500px] min-w-0 overflow-hidden bg-card rounded-lg border border-border', className)}>
      <StepIndicator
        currentStep={currentStep}
        steps={steps}
        onStepClick={onStepClick}
      />

      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="h-full min-w-0 overflow-y-auto px-6 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export type { WizardStep }
