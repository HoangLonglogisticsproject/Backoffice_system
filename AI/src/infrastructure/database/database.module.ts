import { Global, Module } from '@nestjs/common';
import { DATABASE } from '../../common/types/database.port';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [DatabaseService, { provide: DATABASE, useExisting: DatabaseService }],
  exports: [DatabaseService, DATABASE],
})
export class DatabaseModule {}
