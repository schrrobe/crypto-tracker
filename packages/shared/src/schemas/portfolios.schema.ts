import { z } from 'zod'

// Multi-Portfolio: strikt getrennte Steuersubjekte unter einem Account.
// Endpunkte akzeptieren eine optionale portfolioId — weggelassen = Default-Portfolio.

export const createPortfolioSchema = z.object({
  label: z.string().trim().min(1).max(60),
})

export const updatePortfolioSchema = createPortfolioSchema

// wiederverwendbar für Reads ohne eigenes Query-Schema
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
