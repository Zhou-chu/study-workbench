import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', className = '', type = 'button', ...props }, ref) { return <button ref={ref} type={type} className={`button button-${variant} ${className}`} {...props}/>; });
