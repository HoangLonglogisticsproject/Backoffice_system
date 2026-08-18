import type { AxiosError } from "axios";

interface BaseErrorResponse {
  message?: string;
}

export function handleAxiosError<T extends BaseErrorResponse>(
  error: unknown,
): {
  success: false;
  status: number;
  message: string;
} {
  if (isAxiosError<T>(error)) {
    const status = error.response?.status ?? 500;

    if (status === 401 || status === 403) {
      // redirect client-side
      window.location.href = "/login";
    }

    return {
      success: false,
      status,
      message: error.response?.data?.message ?? "Request failed",
    };
  }

  return {
    success: false,
    status: 500,
    message: "Unexpected error",
  };
}

function isAxiosError<T>(error: unknown): error is AxiosError<T> {
  return typeof error === "object" && error !== null && "isAxiosError" in error;
}
