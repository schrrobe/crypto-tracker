import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Passwort muss mindestens 10 Zeichen haben').max(128),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginSchema>

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})
export type RefreshInput = z.infer<typeof refreshSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
})
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, 'Passwort muss mindestens 10 Zeichen haben').max(128),
})
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface UserDto {
  id: string
  email: string
  baseCurrency: string
  createdAt: string
}
