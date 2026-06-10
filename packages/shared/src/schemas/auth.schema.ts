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
