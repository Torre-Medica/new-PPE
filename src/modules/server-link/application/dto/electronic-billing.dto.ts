import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ElectronicBillingContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName!: string;
}

export class CreateElectronicBillingCustomerDto {
  @IsString()
  @IsIn(['Person', 'Company'])
  personType!: 'Person' | 'Company';

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  identification!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  idIdentificationType!: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  address?: string = 'C';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityId!: number;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phoneNumber?: string = '1';

  @IsBoolean()
  vatResponsible!: boolean;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  idCodeFiscalResponsabilities?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ElectronicBillingContactDto)
  contacts?: ElectronicBillingContactDto[];
}
