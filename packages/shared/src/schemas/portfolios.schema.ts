import { z } from 'zod'

// Multi-portfolio: strictly separated tax subjects under one account.
// Endpoints accept an optional portfolioId — omitted = default portfolio.

export const createPortfolioSchema = z.object({
  label: z.string().trim().min(1).max(60),
})

export const updatePortfolioSchema = createPortfolioSchema

// reusable for reads without their own query schema
export const portfolioScopeQuerySchema = z.object({
  portfolioId: z.string().uuid().optional(),
})

export interface PortfolioDto {
  id: string
  label: string
  isDefault: boolean
  sourceCount: number
  createdAt: string
}
