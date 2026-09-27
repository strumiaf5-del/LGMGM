// Type definitions for authentication
// FIX M9: alineado con el backend (backend/auth.py):
//   - handle_me (GET /auth/me) retorna {id, email, name, role, status} (5 campos)
//   - handle_login (POST /auth/login).user = {id, email, name, role} (sin status)
//   - handle_list_users (GET /auth/admin/users) item = User & {created_at, approved_at}
// Antes `User` no declaraba role/status y tenía `avatar?` que el backend nunca manda.

export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'rejected';

// Shape de GET /auth/me (y del .user en POST /auth/login, sin status).
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status?: UserStatus;  // siempre presente en /auth/me, ausente en /auth/login.user
}

// Item de GET /auth/admin/users (campos extra de timestamp).
export interface AdminListUser extends User {
  status: UserStatus;       // en la lista siempre está presente
  created_at: number;
  approved_at: number | null;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export type LoginCredentials = Pick<User, 'email'> & { password: string };

export type AuthError = {
  message: string;
  code?: string;
};
