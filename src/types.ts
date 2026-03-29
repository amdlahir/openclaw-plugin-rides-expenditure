import { z } from "zod";

export const ProviderSchema = z.enum(["grab", "gojek"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const CategorySchema = z.enum(["work", "personal"]);
export type Category = z.infer<typeof CategorySchema>;

export const CurrencySchema = z.enum(["SGD", "USD", "MYR"]);
export type Currency = z.infer<typeof CurrencySchema>;

export const RideSourceSchema = z.enum(["email", "screenshot", "manual"]);
export type RideSource = z.infer<typeof RideSourceSchema>;

export const ExtractedRideSchema = z.object({
  provider: ProviderSchema,
  amount: z.number().positive(),
  date: z.string().nullable(),
  pickup: z.string().nullable(),
  dropoff: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedRide = z.infer<typeof ExtractedRideSchema>;

export const ExtractedRideErrorSchema = z.object({
  error: z.string(),
});

export const ExtractionResultSchema = z.union([
  ExtractedRideSchema,
  ExtractedRideErrorSchema,
]);
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
