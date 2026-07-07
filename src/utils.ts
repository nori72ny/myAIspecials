import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export class ProductionLogger {
  private static isProd = true;

  static log(message: string, ...optionalParams: any[]) {
    if (!this.isProd) {
      void 0 //(`[ACOS INFO]: ${message}`, ...optionalParams);
    }
  }

  static warn(message: string, ...optionalParams: any[]) {
    if (!this.isProd) {
      console.warn(`[ACOS WARN]: ${message}`, ...optionalParams);
    }
  }

  static error(message: string, ...optionalParams: any[]) {
    console.error(`[ACOS ERROR]: ${message}`, ...optionalParams);
  }
}

export class SafeStorage {
  static get<T>(key: string, validator: (data: any) => boolean): T | null {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) {
        return null;
      }
      const parsed = JSON.parse(stored);
      if (validator(parsed)) {
        return parsed as T;
      } else {
        ProductionLogger.error(`Validation failed for key "${key}". Automatic cleanup triggered.`);
        localStorage.removeItem(key);
        return null;
      }
    } catch (e) {
      ProductionLogger.error(`Error reading key "${key}" from localStorage:`, e);
      try {
        localStorage.removeItem(key);
      } catch (err) {
        // Safe fallback
      }
      return null;
    }
  }

  static set<T>(key: string, value: T): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      ProductionLogger.error(`Error writing key "${key}" to localStorage:`, e);
      return false;
    }
  }

  static remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      ProductionLogger.error(`Error removing key "${key}" from localStorage:`, e);
    }
  }

  // Backwards compatibility
  static getItem<T>(key: string, validator: (data: any) => boolean, defaultValue: T): T {
    const res = this.get<T>(key, validator);
    return res !== null ? res : defaultValue;
  }

  static setItem<T>(key: string, value: T): boolean {
    return this.set(key, value);
  }
}
