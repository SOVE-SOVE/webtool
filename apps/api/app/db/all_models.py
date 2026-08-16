"""
Import every module's models here, for side effects only, so that
Base.metadata knows about every table before Alembic autogenerates a
migration or `Base.metadata.create_all` is called. Nothing in this file
should be imported directly — import from the owning module instead.
"""

from app.modules.activity_log import models as _activity_log  # noqa: F401
from app.modules.businesses import models as _businesses  # noqa: F401
from app.modules.clients import models as _clients  # noqa: F401
from app.modules.contacts import models as _contacts  # noqa: F401
from app.modules.deployments import models as _deployments  # noqa: F401
from app.modules.design_briefs import models as _design_briefs  # noqa: F401
from app.modules.interactions import models as _interactions  # noqa: F401
from app.modules.lead_scores import models as _lead_scores  # noqa: F401
from app.modules.leads import models as _leads  # noqa: F401
from app.modules.meetings import models as _meetings  # noqa: F401
from app.modules.pipeline import models as _pipeline  # noqa: F401
from app.modules.projects import models as _projects  # noqa: F401
from app.modules.qa_reports import models as _qa_reports  # noqa: F401
from app.modules.sales_opportunities import models as _sales_opportunities  # noqa: F401
from app.modules.tasks import models as _tasks  # noqa: F401
from app.modules.users import models as _users  # noqa: F401
from app.modules.website_audits import models as _website_audits  # noqa: F401
from app.modules.websites import models as _websites  # noqa: F401
from app.modules.workspaces import models as _workspaces  # noqa: F401
