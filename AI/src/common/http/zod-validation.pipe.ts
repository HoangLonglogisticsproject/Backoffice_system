import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import { ValidationError } from '../errors/domain.error';

/**
 * Request validation with the schema library already validating the
 * environment. Emits a `ValidationError`, so the filter turns it into the
 * shared 422 envelope and this pipe never learns what a status code is.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  // `Input = unknown`: a schema whose transforms change the shape (a CSV
  // string becoming a list) is still a schema for T.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const details: Record<string, string> = {};
      for (const issue of result.error.issues) {
        details[issue.path.join('.') || '(body)'] = issue.message;
      }
      throw new ValidationError('Request failed validation.', details);
    }

    return result.data;
  }
}
