export interface User {
  id: string;
  email: string;
  name?: string;
  role_id?: number;
  username?: string;
}

export interface LoginPayload {
  username?: string;
  email?: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  user: User;
}
