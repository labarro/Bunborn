import { z } from 'zod';
const point = { x: z.number().int().min(0).max(11), y: z.number().int().min(0).max(11) };
const meter = z.number().min(0).max(100),
  time = z.number().finite().min(0),
  short = z.string().max(200);
export const stateSchema = z
  .object({
    schema: z.literal(1),
    id: z.literal('principal'),
    bornAt: time,
    updatedAt: time,
    virtualMinutes: time,
    multiplier: z.number().int().min(1).max(12),
    paused: z.boolean(),
    revision: z.number().int().min(0),
    nextDecisionAt: time,
    decisions: z.number().int().min(0),
    failures: z.number().int().min(0),
    identity: z
      .object({
        name: z.string().min(1).max(160).nullable(),
        description: z.string().max(2000),
        version: z.number().int().min(0),
        traits: z.partialRecord(
          z.enum([
            'nome',
            'autodescricao',
            'preferencia',
            'valor',
            'crenca',
            'estilo',
            'aparencia',
          ]),
          z
            .object({
              value: short,
              evidence: z.array(short).max(8),
              version: z.number().int().min(0),
            })
            .strict(),
        ),
      })
      .strict(),
    needs: z
      .object({
        fome: meter,
        sede: meter,
        sono: meter,
        energia: meter,
        higiene: meter,
        conforto: meter,
        saude: meter,
      })
      .strict(),
    motives: z
      .object({
        curiosidade: meter,
        tedio: meter,
        satisfacao: meter,
        criatividade: meter,
        frustracao: meter,
        interacao: meter,
        motivacao: meter,
      })
      .strict(),
    activity: z.object({kind:short,until:time,target:short,intention:short,involuntary:z.boolean().optional(),startNeeds:z.record(z.string(),z.number().min(0).max(100)).optional()}).strict(),
    queue:z.array(z.object({kind:short,until:time,target:short,intention:short,involuntary:z.boolean().optional(),startNeeds:z.record(z.string(),z.number().min(0).max(100)).optional()}).strict()).max(4).optional(),
    lastCompleted:z.object({kind:short,until:time,target:short,intention:short,involuntary:z.boolean().optional(),startNeeds:z.record(z.string(),z.number().min(0).max(100)).optional()}).strict().optional(),
    position: z.object(point).strict(),
    objects: z
      .array(
        z
          .object({
            id: short,
            label: short,
            kind: short,
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            ...point,
            artifactId: short.optional(),
          })
          .strict(),
      )
      .min(11)
      .max(120),
    complexNext: z.boolean(),
    lastConsolidation: time,
    working: z.array(z.string().max(2000)).max(8),
    lastModel: short.nullable(),
    lastDecisionAt: time.optional(),
  })
  .strict();
