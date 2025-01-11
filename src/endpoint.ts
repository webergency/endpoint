import { Module, SetMetadata, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { NestFactory, Reflector, APP_PIPE, APP_GUARD, HttpAdapterHost } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthGuard, CreateContextMiddleware } from './auth';
import { cookieParser, importRecursive } from './server/helpers';
import { AllExceptionsFilter } from './server/allExceptionsFilter';

import { ContextProvider } from './providers';
import { EndpointOptions } from './exports';
import Fastify from 'fastify';

export * from './exports';

export const IS_PUBLIC_KEY = 'isPublic';
export const IS_WORKER_KEY = 'isWorker';
export const Public = () => SetMetadata( IS_PUBLIC_KEY, true );
export const Roles = Reflector.createDecorator<string[]>();

const dateReviver = ( key: string, value: any ) =>
{
    if( typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/)){ return new Date( value )}

    return value;
}

export default class Endpoint<CoreType>
{
    constructor( private options: EndpointOptions<CoreType> )
    {
        this.init();
    }

    private async init()
    {
        const self = this;

        if( typeof this.options.controllers === 'string' )
        {
            this.options.controllers = await importRecursive( this.options.controllers,
                ( _, exported ) => typeof exported === 'function' && exported.name.endsWith( 'Controller' )
            );
        }

        if( typeof this.options.providers === 'string' )
        {
            this.options.providers = await importRecursive( this.options.providers, 
                ( _, exported ) => typeof exported === 'function' && exported.name.endsWith( 'Provider' )
            );
        }

        @Module(
        {
            imports     : [],
            controllers : this.options.controllers,
            providers   : 
            [
                {
                    provide: APP_GUARD,
                    useClass: AuthGuard
                },
                ContextProvider,
                ...this.options.providers || []
            ],
        })
        class APIModule implements NestModule
        {
            configure( consumer: MiddlewareConsumer )
            {
                consumer.apply( CreateContextMiddleware( self.options.guard, self.options.core )).forRoutes('*');
            }
        }

        const app = await NestFactory.create<NestFastifyApplication>( APIModule, new FastifyAdapter({ ignoreTrailingSlash: true }));

        app.useGlobalFilters( new AllExceptionsFilter( app.get( HttpAdapterHost ).httpAdapter as any ) );

        app.useBodyParser('application/json', { bodyLimit: 12 * 1024 * 1024 }, ( _, body: string | Buffer, done ) => 
        {
            try
            {
                done( null, JSON.parse( typeof body === 'string' ? body : body.toString(), dateReviver ))
            }
            catch( err: any )
            {
                err.statusCode = 400
                done( err, undefined );
            }
        });

        app.use(( req, res, next ) => 
        {
            res.setHeader( 'Access-Control-Allow-Origin', req.headers.origin || req.headers.referer || '*' );
            res.setHeader( 'Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS' );
            res.setHeader( 'Access-Control-Allow-Headers', '*' );
            res.setHeader( 'Access-Control-Allow-Credentials', 'true' );

            if( req.method === 'OPTIONS' )
            {
                res.statusCode = 204;
                res.end();
            }
            else{ next() }
        });

        app.use( cookieParser );
        //app.use( express.urlencoded({ extended: true, limit: '2mb' }), express.json({ limit: '16mb', reviver: dateReviver }));

        let document:OpenAPIObject;
        
        /*
        if( this.options?.swagger )
        {
            document = this.options.swagger as OpenAPIObject
        }
        else
        {
            const config = new DocumentBuilder()
                .setTitle('Your API Documentation')
                .setDescription('API documentation for your NestJS application')
                .setVersion('1.0')
                .addTag('nestjs')
                .build();

            document = SwaggerModule.createDocument( app, config );
        }

        SwaggerModule.setup( '/docs', app, document );
        */

        app.listen( parseInt( this.options.port.toString() ));

        /*this.options.swagger && app.use( '/docs/swagger.json', ( req, res ) =>
        {
            res.json( this.options.swagger );
        });*/
    }
}