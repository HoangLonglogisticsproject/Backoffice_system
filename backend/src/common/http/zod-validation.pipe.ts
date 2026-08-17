import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { ValidationError } from '../errors/domain.error';

/**
 * Request validation with the schema library already in the project.
 *
 * `class-validator` is the Nest default, but it would be a SECOND validation
 * library alongside the zod already validating the environment — two ways to
 * express the same idea, two sets of rules to keep in step. One is enough.
 *
 * Emits a `ValidationError`, so the existing filter turns it into HTTP and
 * this pipe never learns what a status code is.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

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
