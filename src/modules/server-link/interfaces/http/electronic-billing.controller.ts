import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '@common/security/public.decorator';
import { NexoBackRestService } from '@modules/server-link/application/nexo-back-rest.service';
import { CreateElectronicBillingCustomerDto } from '@modules/server-link/application/dto/electronic-billing.dto';

@Public()
@Controller('electronic-billing')
export class ElectronicBillingController {
  constructor(
    private readonly nexoBackRestService: NexoBackRestService,
    private readonly configService: ConfigService,
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

  @Post('customers')
  createCustomer(@Body() dto: CreateElectronicBillingCustomerDto) {
    this.assertElectronicBillingEnabled();
    return this.nexoBackRestService.createElectronicBillingCustomer(dto);
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
