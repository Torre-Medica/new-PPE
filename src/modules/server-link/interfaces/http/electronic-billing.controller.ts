import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '@common/security/public.decorator';
import { NexoBackRestService } from '@modules/server-link/application/nexo-back-rest.service';
import { BillingContactValidationService } from '@modules/server-link/application/billing-contact-validation.service';
import {
  CreateElectronicBillingCustomerDto,
  UpdateElectronicBillingCustomerDto,
  UpdateElectronicBillingCustomerEmailDto,
} from '@modules/server-link/application/dto/electronic-billing.dto';

@Public()
@Controller('electronic-billing')
export class ElectronicBillingController {
  constructor(
    private readonly nexoBackRestService: NexoBackRestService,
    private readonly configService: ConfigService,
    private readonly contactValidation: BillingContactValidationService,
  ) {}

  @Get('catalogs')
  getCatalogs() {
    this.assertElectronicBillingEnabled();
    return this.nexoBackRestService.getElectronicBillingCatalogs();
  }

  @Get('customers/:identification')
  searchCustomer(@Param('identification') identification: string) {
    this.assertElectronicBillingEnabled();
    return this.nexoBackRestService.searchElectronicBillingCustomer(identification);
  }

  // El kiosko consulta el correo antes de guardar (aviso en el campo)
  @Get('email-check')
  checkEmail(@Query('email') email = '') {
    this.assertElectronicBillingEnabled();
    return this.contactValidation.checkEmail(email);
  }

  @Post('customers')
  async createCustomer(@Body() dto: CreateElectronicBillingCustomerDto) {
    this.assertElectronicBillingEnabled();
    // Al registrar, el telefono es obligatorio ('1' es el valor por defecto del DTO
    // cuando no se envio)
    const phone = dto.phoneNumber === '1' ? '' : dto.phoneNumber;
    if (!phone?.trim()) throw new BadRequestException('El teléfono es obligatorio');
    this.assertValid(this.contactValidation.checkPhone(phone));
    // 'C' es el valor por defecto del DTO cuando no se envio direccion
    this.assertValid(this.contactValidation.checkAddress(dto.address === 'C' ? '' : dto.address));
    this.assertValid(await this.contactValidation.checkEmail(dto.email));
    return this.nexoBackRestService.createElectronicBillingCustomer({ ...dto, address: dto.address?.trim() });
  }

  // Nombre, correo y/o telefono de un tercero ya registrado (solo lo que cambia)
  @Put('customers/:identification')
  async updateCustomer(
    @Param('identification') identification: string,
    @Body() dto: UpdateElectronicBillingCustomerDto,
  ) {
    this.assertElectronicBillingEnabled();
    const data = {
      firstName: dto.firstName?.trim() || undefined,
      lastName: dto.lastName?.trim() || undefined,
      email: dto.email?.trim() || undefined,
      phoneNumber: dto.phoneNumber?.replace(/\s/g, '') || undefined,
      address: dto.address?.trim() || undefined,
    };
    if (!data.firstName && !data.lastName && !data.email && !data.phoneNumber && !data.address) {
      throw new BadRequestException('No hay datos para actualizar');
    }
    this.assertValid(this.contactValidation.checkPhone(data.phoneNumber));
    if (data.address) this.assertValid(this.contactValidation.checkAddress(data.address));
    if (data.email) this.assertValid(await this.contactValidation.checkEmail(data.email));
    return this.nexoBackRestService.updateElectronicBillingCustomer(identification, data);
  }

  @Put('customers/:identification/email')
  async updateCustomerEmail(
    @Param('identification') identification: string,
    @Body() dto: UpdateElectronicBillingCustomerEmailDto,
  ) {
    this.assertElectronicBillingEnabled();
    this.assertValid(await this.contactValidation.checkEmail(dto.email));
    return this.nexoBackRestService.updateElectronicBillingCustomerEmail(identification, dto.email);
  }

  private assertValid(check: { valid: boolean; reason?: string }) {
    if (!check.valid) throw new BadRequestException(check.reason);
  }

  private assertElectronicBillingEnabled() {
    const enabled = this.configService.get<boolean>(
      'features.electronicBillingEnabled',
      false,
    );

    if (!enabled) {
      throw new ForbiddenException('Facturacion electronica no habilitada en este PPE');
    }
  }
}
