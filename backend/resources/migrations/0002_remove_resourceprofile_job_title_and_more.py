from django.db import migrations, models
import django.db.models.deletion


def backfill_resource_ids(apps, schema_editor):
    """Assign a unique resource_id to every existing ResourceProfile."""
    ResourceProfile = apps.get_model('resources', 'ResourceProfile')
    for profile in ResourceProfile.objects.all().order_by('id'):
        profile.resource_id = f'E{profile.id:03d}'
        profile.save(update_fields=['resource_id'])


class Migration(migrations.Migration):

    dependencies = [
        ('resources', '0001_initial'),
        ('accounts',  '0001_initial'),
    ]

    operations = [
        # 1. Remove old job_title
        migrations.RemoveField(
            model_name='resourceprofile',
            name='job_title',
        ),

        # 2. Add resource_id WITHOUT unique constraint first, null=True so signal won't collide
        migrations.AddField(
            model_name='resourceprofile',
            name='resource_id',
            field=models.CharField(blank=True, null=True, max_length=50, default=None),
            preserve_default=False,
        ),

        # 3. Add level
        migrations.AddField(
            model_name='resourceprofile',
            name='level',
            field=models.CharField(
                blank=True, max_length=5,
                choices=[('L1', 'L1'), ('L2', 'L2'), ('L3', 'L3'), ('L4', 'L4')],
            ),
        ),

        # 4. Add manager FK
        migrations.AddField(
            model_name='resourceprofile',
            name='manager',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='managed_resources',
                limit_choices_to={'role__in': ['admin', 'leadership', 'manager']},
                to='accounts.user',
            ),
        ),

        # 5. Backfill existing rows — RES-0001, RES-0002, ...
        migrations.RunPython(backfill_resource_ids, migrations.RunPython.noop),

        # 6. NOW safe to add unique constraint — all rows have distinct values, NULLs allowed
        migrations.AlterField(
            model_name='resourceprofile',
            name='resource_id',
            field=models.CharField(blank=True, null=True, max_length=50, unique=True),
        ),
    ]