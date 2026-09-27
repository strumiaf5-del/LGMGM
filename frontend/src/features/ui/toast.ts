// Toast notification system
export interface ToastOptions {
  message: string;
  type?: 'error' | 'success' | 'warning' | 'info';
  duration?: number;
}

export class Toast {
  private container: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(this.container);
  }

  error(message: string, duration = 300): void {
    this.show({ message, type: 'error', duration });
  }

  success(message: string, duration = 300): void {
    this.show({ message, type: 'success', duration });
  }

  warning(message: string, duration = 300): void {
    this.show({ message, type: 'warning', duration });
  }

  info(message: string, duration = 300): void {
    this.show({ message, type: 'info', duration });
  }

  private show(options: ToastOptions): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${options.type || 'info'}`;
    toast.textContent = options.message;

    this.container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Remove after duration
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300); // Wait for animation
    }, options.duration);
  }
}

export const toast = new Toast();