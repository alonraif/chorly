import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ShoppingAddSchema, ShoppingUpdateSchema } from '@chorly/shared';
import { CurrentUser } from '../common/session/current-user.decorator';
import { RequireUserGuard } from '../common/session/require-user.guard';
import type { RequestUser } from '../common/session/session.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ShoppingService } from './shopping.service';

// The list belongs to the whole family, so everyone signed in can do all of this, kids included.
@ApiTags('shopping')
@Controller('/shopping')
@UseGuards(RequireUserGuard)
export class ShoppingController {
  constructor(private readonly shopping: ShoppingService) {}

  @Get()
  @ApiOperation({ summary: 'The list, recent purchases, everything known for autocomplete, and who is out shopping' })
  list(@CurrentUser() user: RequestUser) {
    return this.shopping.list(user.tenantId);
  }

  @Post('/items')
  @ApiOperation({ summary: 'Put an item on the list; adding one that is already there changes nothing' })
  add(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(ShoppingAddSchema)) body: any) {
    return this.shopping.add(user, body);
  }

  @Patch('/items/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Change an item; turning urgent on tells the family' })
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(ShoppingUpdateSchema)) body: any) {
    return this.shopping.update(user, id, body);
  }

  @Post('/items/:id/buy')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Check an item off' })
  buy(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.shopping.buy(user, id);
  }

  @Post('/items/:id/unbuy')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Put a checked-off item back on the list' })
  unbuy(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.shopping.unbuy(user, id);
  }

  @Delete('/items/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Take an item off the list, or forget one that is already off it' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.shopping.remove(user, id);
  }

  @Post('/trip')
  @ApiOperation({ summary: 'Say you are going shopping, which tells the family' })
  startTrip(@CurrentUser() user: RequestUser) {
    return this.shopping.startTrip(user);
  }

  @Delete('/trip')
  @ApiOperation({ summary: 'Say you are done shopping' })
  endTrip(@CurrentUser() user: RequestUser) {
    return this.shopping.endTrip(user);
  }
}
